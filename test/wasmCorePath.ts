import { createRequire } from 'node:module'

/** Test stand-in for `web-tree-sitter/web-tree-sitter.wasm?url`: emscripten
 * accepts an absolute fs path when running under Node. */
const require = createRequire(import.meta.url)
const wasmPath = require
  .resolve('web-tree-sitter')
  .replace(/web-tree-sitter\.c?js$/, 'web-tree-sitter.wasm')
export default wasmPath
