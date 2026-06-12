import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/** electron-vite's `?asset` imports (icons etc.) become empty strings in tests. */
function assetStub(): Plugin {
  return {
    name: 'argus-asset-stub',
    enforce: 'pre',
    resolveId(id) {
      if (id.includes('?asset')) return `\0argus-asset:${id}`
      return null
    },
    load(id) {
      if (id.startsWith('\0argus-asset:')) return 'export default ""'
      return null
    }
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [assetStub()],
        resolve: {
          alias: {
            // main-process tests run in plain Node; the Electron runtime is
            // the one external dependency we replace (test/electronStub.ts)
            electron: resolve(__dirname, 'test/electronStub.ts')
          }
        },
        test: {
          name: 'main',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          environment: 'node',
          server: {
            deps: {
              // CJS deps that require('electron') must be inlined so the
              // alias above applies to them too
              inline: ['@electron-toolkit/utils']
            }
          }
        }
      },
      {
        resolve: {
          alias: [
            // `.wasm?url` imports become absolute fs paths in tests
            // (emscripten reads local paths under Node)
            {
              find: /^web-tree-sitter\/web-tree-sitter\.wasm\?url$/,
              replacement: resolve(__dirname, 'test/wasmCorePath.ts')
            },
            {
              // consume the whole specifier: a partial regex match would keep
              // the './' prefix and break resolution
              find: /^.*tree-sitter-ruby\.wasm\?url$/,
              replacement: resolve(__dirname, 'test/wasmRubyPath.ts')
            }
          ]
        },
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['test/setup.renderer.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/shared/types.ts',
        'src/main/index.ts',
        'src/preload/**',
        'src/renderer/src/main.tsx',
        'src/renderer/src/App.tsx',
        'src/renderer/src/assets/**',
        'src/renderer/src/ruby/*.wasm'
      ],
      reporter: ['text', 'html', 'json-summary']
    }
  }
})
