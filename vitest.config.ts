import { defineConfig } from 'vitest/config'

// Only this project's tests. Without this, vitest also picks up test files inside stray folders
// such as _to_delete/node_modules_linux_vm and the default `npm test` fails.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '_to_delete/**', 'dist/**'],
  },
})
