import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          environment: 'node'
        }
      },
      {
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
