//
// UI tests that do not need a real device attached.
//
// Test titles carry a [check:<key>] tag; .github/scripts/playwright-checks.mts
// turns those into the per-Android-version columns of the PR report.
//

import {test, expect} from '@playwright/test'
import * as h from './helpers.ts'

test.describe('STF web UI', function() {
  test.describe.configure({mode: 'serial'})

  test('[check:playwright_ui] mock auth signs in and lands on the device list',
    async function({page}) {
      const errors = await h.collectConsoleErrors(page)

      await page.goto('/auth/mock/')
      await expect(page.locator(h.SEL.loginForm)).toBeVisible()
      await expect(page.locator(h.SEL.loginName)).toBeVisible()
      await expect(page.locator(h.SEL.loginEmail)).toBeVisible()

      await page.fill(h.SEL.loginName, h.USER_NAME)
      await page.fill(h.SEL.loginEmail, h.USER_EMAIL)
      await page.click(h.SEL.loginSubmit)

      await page.waitForURL(/#\/devices/, {timeout: 90000})
      await expect(page.locator(h.SEL.deviceList)).toBeVisible()
      await expect(page.locator(h.SEL.loginError)).toHaveCount(0)

      const fatal = errors.filter(function(text) {
        return /Minified React error|ChunkLoadError|Loading chunk/.test(text) ||
          /Unexpected token|is not a function|Cannot read properties/.test(text)
      })
      expect(fatal, 'fatal errors on the device list').toEqual([])
    })

  test('[check:playwright_ui] the menu reports a version and the signed in user',
    async function({page}) {
      await h.login(page)

      await expect(page.locator(h.SEL.version)).toHaveText(/^v\d+\.\d+\.\d+/)
      await expect(
        page.locator('.device-stats .current-user-name')
      ).toHaveText(h.USER_NAME)
    })

  test('[check:playwright_ui] the device list search box filters tiles',
    async function({page}) {
      await h.login(page)

      const search = page.locator(h.SEL.deviceSearch)
      await expect(search).toBeVisible()

      // A query that cannot match anything must hide every tile.
      await search.fill('zzz-no-such-device-zzz')
      await expect(page.locator(h.SEL.deviceTiles)).toHaveCount(0, {
        timeout: 20000
      })

      await search.fill('')
      await expect(page.locator(h.SEL.deviceSearch)).toHaveValue('')
    })

  test('[check:playwright_ui] the settings page renders',
    async function({page}) {
      await h.login(page)

      await page.goto('/#/settings')
      await expect(page.locator('.stf-settings'))
        .toBeVisible({timeout: 30000})
      await expect(
        page.locator('.stf-settings .heading-for-tabs')
      ).toBeVisible()
    })

  test('[check:playwright_ui] every settings tab each user has renders',
    async function({page}) {
      await h.login(page)

      await page.goto('/#/settings')
      const tabs = page.locator('.stf-settings .heading-for-tabs .nav-tabs a')
      await expect(tabs.nth(0)).toHaveText('General', {timeout: 30000})
      await expect(tabs.nth(1)).toHaveText('Keys')
      await expect(tabs.nth(2)).toHaveText('Groups')

      const visits: [string, string][] =
        [['keys', 'Keys'], ['groups', 'Groups'], ['general', 'General']]
      for (const [tab, title] of visits) {
        await page.locator('.stf-settings-tab-' + tab).click()
        await expect(page).toHaveURL(new RegExp('#/settings/' + tab + '$'))
        await expect(page.locator('.stf-settings-tab-' + tab))
          .toHaveAttribute('aria-selected', 'true')
        await expect(page.locator('.stf-settings').getByRole('tabpanel', {name: title}))
          .toBeVisible()
      }
    })

  test('[check:playwright_ui] the groups page renders',
    async function({page}) {
      await h.login(page)

      await page.goto('/#/groups')
      await expect(page.locator('.stf-groups')).toBeVisible({timeout: 30000})
      await expect(page.locator('.stf-groups .groups-table tbody tr').first())
        .toBeVisible({timeout: 30000})
      await expect(page.locator('.stf-groups .contact-owners')).toBeVisible()
    })

  test('[check:playwright_ui] the help page renders wiki content',
    async function({page}) {
      await h.login(page)

      await page.goto('/#/help')
      await expect(page.locator('.stf-docs h1').first())
        .toBeVisible({timeout: 30000})

      await page.locator('.stf-docs .docs-home').click()
      await expect(page).toHaveURL(/#\/docs\/Help$/)
      await expect(page.locator('.stf-docs h1').first())
        .toBeVisible({timeout: 30000})
    })

  test('[check:playwright_ui] the user page shows the signed in user',
    async function({page}) {
      await h.login(page)

      await page.goto('/#/user/' + h.USER_EMAIL)
      await expect(page.locator('.stf-user-profile .user-name'))
        .toHaveText(h.USER_NAME, {timeout: 30000})
    })

  test('[check:playwright_ui] legacy #! links and unknown routes redirect',
    async function({page}) {
      await h.login(page)

      await page.goto('/#!/settings/keys')
      await expect(page).toHaveURL(/#\/settings\/keys$/, {timeout: 30000})
      await expect(page.locator('.stf-settings')).toBeVisible()

      await page.goto('/#!/groups')
      await expect(page).toHaveURL(/#\/groups$/, {timeout: 30000})
      await expect(page.locator('.stf-groups')).toBeVisible()

      await page.goto('/#/no-such-route')
      await expect(page).toHaveURL(/#\/devices$/, {timeout: 30000})
      await expect(page.locator(h.SEL.deviceList)).toBeVisible()
    })

  test('[check:playwright_ui] the color scheme toggle switches themes and persists',
    async function({page}) {
      await page.emulateMedia({colorScheme: 'light'})
      await h.login(page)

      const html = page.locator('html')
      await expect(html).toHaveAttribute('data-mantine-color-scheme', 'light')

      await page.locator('.stf-menu .stf-color-scheme').click()
      await expect(html).toHaveAttribute('data-mantine-color-scheme', 'dark')

      await page.reload()
      await expect(page.locator(h.SEL.deviceList)).toBeVisible({timeout: 30000})
      await expect(html).toHaveAttribute('data-mantine-color-scheme', 'dark')

      await page.locator('.stf-menu .stf-color-scheme').click()
      await expect(html).toHaveAttribute('data-mantine-color-scheme', 'light')
    })

  test('[check:playwright_ui] logout returns to the sign-in form',
    async function({page}) {
      await h.login(page)

      await page.locator('.stf-menu .stf-logout').click()
      await expect(page.locator(h.SEL.loginForm)).toBeVisible({timeout: 30000})

      await page.goto('/#/devices')
      await expect(page.locator(h.SEL.loginForm)).toBeVisible({timeout: 30000})
    })
})
