import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// `npm run test:qemu` also runs the integration tests that boot a real (headless) VM
const withQemu = process.env.QEMU_IT === '1'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: withQemu ? ['tests/**/*.test.ts'] : ['tests/*.test.ts'],
    environment: 'node',
    testTimeout: withQemu ? 60000 : 5000
  }
})
