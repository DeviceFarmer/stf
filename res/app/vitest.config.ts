import path from 'node:path'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  root: __dirname
  , cacheDir: path.resolve(__dirname, '../../node_modules/.vite')
  , resolve: {
    alias: [
      {find: /^.*\/i18n-catalogs$/, replacement: path.resolve(__dirname, 'src/test/i18n-catalogs.ts')}
      , {find: '@', replacement: path.resolve(__dirname, 'src')}
    ]
  }
  , test: {
    environment: 'jsdom'
    , include: ['src/**/*.test.{ts,tsx}']
  }
})
