/**
 * Copyright © CyberAgent, Inc. All Rights Reserved.
 * Copyright © The OpenSTF Project. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export const BUNDLED_BROWSER_ICONS = [
  'chrome'
, 'chromium'
, 'firefox'
, 'edge'
, 'opera'
, 'brave'
, 'vivaldi'
, 'samsung'
, 'duckduckgo'
, 'yandex'
] as const

export type SupportedBrowserIcon = (typeof BUNDLED_BROWSER_ICONS)[number]

export interface BrowserPlatform {
  package: string
  system?: boolean
}

export interface BrowserEntry {
  name: string
  icon: SupportedBrowserIcon | null
  developer?: string
  system?: boolean
  platforms?: {
    android?: BrowserPlatform
  }
}

const rawBrowserPackages: Record<string, BrowserEntry> = {
  // --- Google Chrome family ---
  'com.android.chrome': {
    name: 'Chrome'
  , icon: 'chrome'
  , developer: 'Google Inc.'
  }
, 'com.chrome.beta': {
    name: 'Chrome Beta'
  , icon: 'chrome'
  , developer: 'Google Inc.'
  }
, 'com.chrome.dev': {
    name: 'Chrome Dev'
  , icon: 'chrome'
  , developer: 'Google Inc.'
  }
, 'com.chrome.canary': {
    name: 'Chrome Canary'
  , icon: 'chrome'
  , developer: 'Google Inc.'
  }

  // --- Chromium & WebView family ---
, 'org.chromium.chrome': {
    name: 'Chromium'
  , icon: 'chromium'
  , developer: 'The Chromium Authors'
  }
, 'com.android.browser': {
    name: 'Browser'
  , icon: 'chromium'
  , developer: 'Google Inc.'
  , system: true
  }
, 'org.chromium.webview_shell': {
    name: 'Android WebView Shell'
  , icon: 'chromium'
  , developer: 'The Chromium Authors'
  }
, 'com.google.android.webview': {
    name: 'Android System WebView'
  , icon: 'chromium'
  , developer: 'Google Inc.'
  }
, 'com.android.webview': {
    name: 'Android System WebView'
  , icon: 'chromium'
  , developer: 'Google Inc.'
  }
, 'com.google.android.browser': {
    name: 'Browser'
  , icon: 'chromium'
  , developer: 'Google Inc.'
  , system: true
  }

  // --- Mozilla Firefox family ---
, 'org.mozilla.firefox': {
    name: 'Firefox'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }
, 'org.mozilla.firefox_beta': {
    name: 'Firefox Beta'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }
, 'org.mozilla.fenix': {
    name: 'Firefox Nightly'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }
, 'org.mozilla.fennec_aurora': {
    name: 'Firefox Nightly'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }
, 'org.mozilla.focus': {
    name: 'Firefox Focus'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }
, 'org.mozilla.klar': {
    name: 'Firefox Klar'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }
, 'org.mozilla.fennec': {
    name: 'Fennec'
  , icon: 'firefox'
  , developer: 'Mozilla'
  }

  // --- Microsoft Edge family ---
, 'com.microsoft.emmx': {
    name: 'Microsoft Edge'
  , icon: 'edge'
  , developer: 'Microsoft Corporation'
  }
, 'com.microsoft.emmx.beta': {
    name: 'Microsoft Edge Beta'
  , icon: 'edge'
  , developer: 'Microsoft Corporation'
  }
, 'com.microsoft.emmx.dev': {
    name: 'Microsoft Edge Dev'
  , icon: 'edge'
  , developer: 'Microsoft Corporation'
  }
, 'com.microsoft.emmx.canary': {
    name: 'Microsoft Edge Canary'
  , icon: 'edge'
  , developer: 'Microsoft Corporation'
  }

  // --- Opera family ---
, 'com.opera.browser': {
    name: 'Opera'
  , icon: 'opera'
  , developer: 'Opera Software ASA'
  }
, 'com.opera.browser.beta': {
    name: 'Opera Beta'
  , icon: 'opera'
  , developer: 'Opera Software ASA'
  }
, 'com.opera.mini.android': {
    name: 'Opera Mini'
  , icon: 'opera'
  , developer: 'Opera Software ASA'
  }
, 'com.opera.mini.native': {
    name: 'Opera Mini'
  , icon: 'opera'
  , developer: 'Opera Software ASA'
  }
, 'com.opera.gx': {
    name: 'Opera GX'
  , icon: 'opera'
  , developer: 'Opera Software ASA'
  }
, 'com.opera.touch': {
    name: 'Opera Touch'
  , icon: 'opera'
  , developer: 'Opera Software ASA'
  }

  // --- Brave family ---
, 'com.brave.browser': {
    name: 'Brave'
  , icon: 'brave'
  , developer: 'Brave Software'
  }
, 'com.brave.browser_beta': {
    name: 'Brave Beta'
  , icon: 'brave'
  , developer: 'Brave Software'
  }
, 'com.brave.browser_nightly': {
    name: 'Brave Nightly'
  , icon: 'brave'
  , developer: 'Brave Software'
  }

  // --- Vivaldi family ---
, 'com.vivaldi.browser': {
    name: 'Vivaldi'
  , icon: 'vivaldi'
  , developer: 'Vivaldi Technologies'
  }
, 'com.vivaldi.browser.snapshot': {
    name: 'Vivaldi Snapshot'
  , icon: 'vivaldi'
  , developer: 'Vivaldi Technologies'
  }

  // --- Samsung Internet family ---
, 'com.sec.android.app.sbrowser': {
    name: 'Samsung Internet'
  , icon: 'samsung'
  , developer: 'Samsung'
  }
, 'com.sec.android.app.sbrowser.beta': {
    name: 'Samsung Internet Beta'
  , icon: 'samsung'
  , developer: 'Samsung'
  }
, 'com.sec.webbrowserminiapp': {
    name: 'Popup Browser'
  , icon: 'samsung'
  , developer: 'Samsung'
  }

  // --- DuckDuckGo family ---
, 'com.duckduckgo.mobile.android': {
    name: 'DuckDuckGo'
  , icon: 'duckduckgo'
  , developer: 'DuckDuckGo'
  }

  // --- Yandex family ---
, 'com.yandex.browser': {
    name: 'Yandex Browser'
  , icon: 'yandex'
  , developer: 'Yandex'
  }
, 'com.yandex.browser.beta': {
    name: 'Yandex Browser Beta'
  , icon: 'yandex'
  , developer: 'Yandex'
  }

  // --- Other known browsers (fallback to generic globe icon) ---
, 'com.amazon.cloud9': {
    name: 'Silk'
  , icon: null
  , developer: 'Amazon'
  , system: true
  }
, 'com.asus.browser': {
    name: 'Browser'
  , icon: null
  , developer: 'ASUS'
  , system: true
  }
, 'com.baidu.browser.inter': {
    name: 'Baidu'
  , icon: null
  , developer: 'Baidu Inc.'
  }
, 'com.baidu.searchbox_oppo': {
    name: 'Baidu'
  , icon: null
  , developer: 'Baidu for Oppo'
  }
, 'com.cloudmosa.puffinFree': {
    name: 'Puffin Web Browser Free'
  , icon: null
  , developer: 'CloudMosa Inc.'
  }
, 'com.explore.web.browser': {
    name: 'Explore'
  , icon: null
  , developer: 'Litter Penguin'
  }
, 'com.fujitsu.mobile_phone.fbrowser': {
    name: 'Simplified Browser'
  , icon: null
  , developer: 'Fujitsu'
  }
, 'com.htc.sense.browser': {
    name: 'Browser'
  , icon: null
  , developer: 'HTC'
  }
, 'com.lenovo.browser': {
    name: 'Browser'
  , icon: null
  , developer: 'Lenovo'
  }
, 'com.mx.browser': {
    name: 'Maxthon'
  , icon: null
  , developer: 'Maxthon Browser'
  }
, 'com.tencent.ibibo.mtt': {
    name: 'ONE'
  , icon: null
  , developer: 'Tencent Mobile International Ltd.'
  }
, 'com.UCMobile.intl': {
    name: 'UC'
  , icon: null
  , developer: 'UCWeb Inc.'
  }
, 'com.uc.browser.en': {
    name: 'UC Browser Mini'
  , icon: null
  , developer: 'UCWeb Inc.'
  }
, 'jp.co.yahoo.android.ybrowser': {
    name: 'Yahoo! Browser'
  , icon: null
  , developer: 'Yahoo Japan Corp.'
  }
, 'jp.co.yahoo.android.yjtop': {
    name: 'Yahoo! JAPAN'
  , icon: null
  , developer: 'Yahoo Japan Corp.'
  }
, 'jp.netstar.familysmile': {
    name: 'Family Smile'
  , icon: null
  , developer: 'NetSTAR'
  }
, 'jp.softbank.mb.parentalcontrols': {
    name: 'Parental Controls'
  , icon: null
  , developer: 'SoftBank'
  }
, 'mobi.mgeek.TunnyBrowser': {
    name: 'Dolphin'
  , icon: null
  , developer: 'MoboTap Inc.'
  }
, 'org.torproject.torbrowser': {
    name: 'Tor Browser'
  , icon: null
  , developer: 'The Tor Project'
  }
}

// Populate platforms.android for backwards compatibility and ease of access
const browsers: Record<string, BrowserEntry> = Object.create(null)

for (const [pkg, entry] of Object.entries(rawBrowserPackages)) {
  const fullEntry: BrowserEntry = {
    ...entry
  , platforms: {
      android: {
        package: pkg
      , ...(entry.system ? {system: true} : {})
      }
    }
  }
  browsers[pkg] = fullEntry
}

// Also alias top brand keys for reverse lookup by icon key
for (const icon of BUNDLED_BROWSER_ICONS) {
  if (!browsers[icon]) {
    const canonical = Object.values(browsers).find((b) => b.icon === icon)
    if (canonical) {
      browsers[icon] = canonical
    }
  }
}

export default browsers
