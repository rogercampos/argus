import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Test stand-in for `./tree-sitter-ruby.wasm?url` (vendored grammar). */
const here = dirname(fileURLToPath(import.meta.url))
export default join(here, '../src/renderer/src/ruby/tree-sitter-ruby.wasm')
