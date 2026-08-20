const {defineConfig, devices} = require('@playwright/test')
const path = require('path')

const results = path.resolve(__dirname, '../../test-results/playwright')

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 180000,
  expect: {timeout: 45000},
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  reporter: [
    ['list'],
    ['json', {outputFile: path.join(results, 'report.json')}],
    ['html', {outputFolder: path.join(results, 'html'), open: 'never'}]
  ],

  outputDir: path.join(results, 'artifacts'),

  use: {
    baseURL: process.env.STF_URL || 'http://127.0.0.1:7100',
    // The control page hides the whole desktop layout in basic mode, which is
    // keyed off a mobile user agent, so keep a desktop viewport.
    viewport: {width: 1600, height: 1000},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: {mode: 'on', size: {width: 1280, height: 800}},
    actionTimeout: 45000,
    navigationTimeout: 90000,
    ignoreHTTPSErrors: true
  },

  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']}
    }
  ]
})
