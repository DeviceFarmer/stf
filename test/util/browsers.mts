import fs from 'fs'
import path from 'path'

import * as chai from 'chai'
var expect = chai.expect

import browsers, {BUNDLED_BROWSER_ICONS} from '../../lib/util/browsers.js'
import pathutil from '../../lib/util/pathutil.js'

describe('browsers', function() {
  it('should have valid mapping entries for each browser package', function() {
    var packages = Object.keys(browsers).filter(function(k) {
      return k.includes('.')
    })
    expect(packages.length).to.be.above(0)

    for (var pkg of packages) {
      var item = browsers[pkg]!
      expect(item.name, `${pkg}.name`).to.be.a('string').and.not.empty
      if (item.developer) {
        expect(item.developer, `${pkg}.developer`).to.be.a('string').and.not.empty
      }
      if (item.icon !== null) {
        expect(BUNDLED_BROWSER_ICONS, `${pkg}.icon`).to.include(item.icon)
      }
      expect(item.platforms?.android?.package, `${pkg}.platforms.android.package`).to.equal(pkg)
    }
  })

  it('should have unique Android package names across all mapping entries', function() {
    var packageKeys = Object.keys(browsers).filter(function(k) {
      return k.includes('.')
    })
    var seen = new Set<string>()
    for (var pkg of packageKeys) {
      expect(seen.has(pkg), `duplicate package "${pkg}"`).to.be.false
      seen.add(pkg)
    }
  })

  it('should map browser family variants to their parent brand icon', function() {
    var expectedVariants: Record<string, string> = {
      'com.android.chrome': 'chrome'
    , 'com.chrome.beta': 'chrome'
    , 'com.chrome.dev': 'chrome'
    , 'com.chrome.canary': 'chrome'
    , 'org.chromium.chrome': 'chromium'
    , 'com.android.browser': 'chromium'
    , 'org.chromium.webview_shell': 'chromium'
    , 'org.mozilla.firefox': 'firefox'
    , 'org.mozilla.firefox_beta': 'firefox'
    , 'org.mozilla.fenix': 'firefox'
    , 'org.mozilla.focus': 'firefox'
    , 'org.mozilla.fennec': 'firefox'
    , 'com.microsoft.emmx': 'edge'
    , 'com.microsoft.emmx.beta': 'edge'
    , 'com.microsoft.emmx.dev': 'edge'
    , 'com.microsoft.emmx.canary': 'edge'
    , 'com.opera.browser': 'opera'
    , 'com.opera.browser.beta': 'opera'
    , 'com.opera.mini.android': 'opera'
    , 'com.opera.mini.native': 'opera'
    , 'com.opera.gx': 'opera'
    , 'com.opera.touch': 'opera'
    , 'com.brave.browser': 'brave'
    , 'com.brave.browser_beta': 'brave'
    , 'com.brave.browser_nightly': 'brave'
    , 'com.vivaldi.browser': 'vivaldi'
    , 'com.vivaldi.browser.snapshot': 'vivaldi'
    , 'com.sec.android.app.sbrowser': 'samsung'
    , 'com.sec.android.app.sbrowser.beta': 'samsung'
    , 'com.duckduckgo.mobile.android': 'duckduckgo'
    , 'com.yandex.browser': 'yandex'
    , 'com.yandex.browser.beta': 'yandex'
    }

    for (var [pkg, expectedIcon] of Object.entries(expectedVariants)) {
      expect(browsers[pkg], `browser entry for ${pkg}`).to.exist
      expect(browsers[pkg]!.icon, `${pkg} icon`).to.equal(expectedIcon)
    }
  })

  it('should set icon to null for other known browser package IDs', function() {
    var fallbackPackages = [
      'com.amazon.cloud9'
    , 'com.asus.browser'
    , 'com.baidu.browser.inter'
    , 'com.baidu.searchbox_oppo'
    , 'com.cloudmosa.puffinFree'
    , 'com.explore.web.browser'
    , 'com.fujitsu.mobile_phone.fbrowser'
    , 'com.htc.sense.browser'
    , 'com.lenovo.browser'
    , 'com.mx.browser'
    , 'com.tencent.ibibo.mtt'
    , 'com.UCMobile.intl'
    , 'com.uc.browser.en'
    , 'jp.co.yahoo.android.ybrowser'
    , 'jp.co.yahoo.android.yjtop'
    , 'jp.netstar.familysmile'
    , 'jp.softbank.mb.parentalcontrols'
    , 'mobi.mgeek.TunnyBrowser'
    , 'org.torproject.torbrowser'
    ]

    for (var pkg of fallbackPackages) {
      expect(browsers[pkg], `entry for ${pkg}`).to.exist
      expect(browsers[pkg]!.icon, `${pkg} icon`).to.be.null
    }
  })

  it('should bundle official vector SVG browser icons with valid viewBoxes', function() {
    var iconsDir = pathutil.resource('common/browser-icons')
    expect(fs.existsSync(iconsDir), `${iconsDir} exists`).to.be.true

    var svgFiles = fs.readdirSync(iconsDir)
      .filter(function(file) {
        return file.endsWith('.svg')
      })
      .sort()

    var expectedSvgs = BUNDLED_BROWSER_ICONS.map(function(name) {
      return `${name}.svg`
    }).sort()

    expect(svgFiles).to.deep.equal(expectedSvgs)

    for (var file of svgFiles) {
      var filePath = path.join(iconsDir, file)
      var content = fs.readFileSync(filePath, 'utf8')
      expect(content, `${file} is SVG`).to.include('<svg')
      expect(content, `${file} has viewBox`).to.match(/viewBox=["'][^"']+["']/)
    }
  })

  it('should have a README.md notice with attribution for all bundled browser icons', function() {
    var readmePath = pathutil.resource('common/browser-icons/README.md')
    expect(fs.existsSync(readmePath), 'README.md exists').to.be.true

    var readme = fs.readFileSync(readmePath, 'utf8')
    expect(readme).to.include('Browser Icons Attribution & Trademark Notice')
    expect(readme).to.include('nominative')

    for (var icon of BUNDLED_BROWSER_ICONS) {
      expect(readme, `README mentions ${icon}.svg`).to.include(`\`${icon}.svg\``)
    }
  })
})
