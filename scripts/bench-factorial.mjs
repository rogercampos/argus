// Temporary benchmark: main-process file listing + tree preparation at factorial scale
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prepareFileTreeInput } from '../node_modules/@pierre/trees/dist/preparedInput.js'

const execFileAsync = promisify(execFile)
const root = process.argv[2]

let t = performance.now()
const { stdout } = await execFileAsync(
  'git',
  ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { maxBuffer: 512 * 1024 * 1024 }
)
const paths = stdout.split('\0').filter(Boolean)
console.log(`git ls-files: ${paths.length} paths in ${(performance.now() - t).toFixed(0)}ms`)

t = performance.now()
const prepared = prepareFileTreeInput(paths)
console.log(
  `prepareFileTreeInput: ${prepared.paths.length} entries in ${(performance.now() - t).toFixed(0)}ms`
)

t = performance.now()
await execFileAsync(
  'git',
  ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
  {
    maxBuffer: 512 * 1024 * 1024
  }
)
console.log(`git status: ${(performance.now() - t).toFixed(0)}ms`)
