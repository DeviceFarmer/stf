# Browser Icons Attribution & Trademark Notice

The browser icons in this directory are included solely for nominative
identification of browser applications installed on connected Android devices.
All trademarks, service marks, and logos are the property of their respective
owners.

Except where explicitly noted below under an open-source or Creative Commons
license, these icons are **excluded** from the Apache-2.0 license governing
the rest of the `DeviceFarmer/stf` repository, and their inclusion does not
imply endorsement by or affiliation with the respective trademark holders.

| File | Browser | Source (fetched by `npm run fetch:browser-icons`) | License / Legal Status (as stated on the cited page) |
| :--- | :--- | :--- | :--- |
| `chrome.svg` | Google Chrome | `https://www.google.com/chrome/static/images/chrome-logo.svg` | The source URL states no license. The Wikimedia Commons page [File:Google_Chrome_icon_(February_2022).svg](https://commons.wikimedia.org/wiki/File:Google_Chrome_icon_(February_2022).svg), which names this URL as its source, tags the file as public domain (below the US threshold of originality) and as a trademark. Chrome is a trademark of Google. |
| `chromium.svg` | Chromium | `https://commons.wikimedia.org/wiki/Special:FilePath/Chromium_11_Logo.svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Chromium_11_Logo.svg): BSD (The Chromium projects) and CC BY 2.5, author "The Chromium Authors", attribution required. |
| `firefox.svg` | Mozilla Firefox | `https://raw.githubusercontent.com/mozilla/protocol-assets/main/logos/firefox/browser/logo.svg` | The [mozilla/protocol-assets](https://github.com/mozilla/protocol-assets) repository is under MPL-2.0 (its `LICENSE`); its README does not address the logos separately. See the [Mozilla Trademark Guidelines](https://www.mozilla.org/en-US/foundation/trademarks/policy/) for the Firefox name and logo. |
| `brave.svg` | Brave | `https://commons.wikimedia.org/wiki/Special:FilePath/Brave_lion_icon.svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Brave_lion_icon.svg): MPL 2.0, author Brave Software, Inc., tagged as trademarked; origin given as `https://brave.com/ja/media-assets/`. |
| `vivaldi.svg` | Vivaldi | `https://commons.wikimedia.org/wiki/Special:FilePath/Vivaldi_web_browser_logo.svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Vivaldi_web_browser_logo.svg): CC BY 4.0, credit "Vivaldi Technologies", tagged as trademarked; origin given as `https://vivaldi.com/press/`, whose text says its images are CC-BY-4.0 and that "logos are also subject to trademark restrictions". |
| `opera.svg` | Opera | `https://commons.wikimedia.org/wiki/Special:FilePath/Opera_2015_icon.svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Opera_2015_icon.svg): tagged `PD-textlogo` (public domain, too simple to be copyrightable) and trademarked; origin given as `https://brand.opera.com/`. That brand page is a trademark guideline page, asks that you not create your own art for the Opera logo, and does not state a license. |
| `edge.svg` | Microsoft Edge | `https://commons.wikimedia.org/wiki/Special:FilePath/Microsoft_Edge_logo_(2019).svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Microsoft_Edge_logo_(2019).svg): author Microsoft Corporation, tagged MIT (Expat) and trademarked. The origin given there is a third-party fan wiki (Logopedia), not a Microsoft page; we found no Microsoft statement that licenses the logo. |
| `samsung.svg` | Samsung Internet | `https://commons.wikimedia.org/wiki/Special:FilePath/Samsung_Internet_logo.svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Samsung_Internet_logo.svg): tagged `PD-textlogo` (public domain, too simple to be copyrightable) and trademark; origin given as `https://samsunginter.net/`, a non-Samsung site. |
| `duckduckgo.svg` | DuckDuckGo | `https://staticcdn.duckduckgo.com/press/DuckDuckGo-Brand-Logo.zip` (entry `DuckDuckGo Logo- Dax Solo.svg`) | Official download linked from [duckduckgo.com/press](https://duckduckgo.com/press), which states that the name, logos and trade dress are trademarks of Duck Duck Go, Inc. DuckDuckGo's [`LICENSE.txt`](https://github.com/duckduckgo/duckduckgo/blob/master/LICENSE.txt) says its logos and marks are licensed separately under CC BY-NC-ND 4.0 and that official versions are available from that press page. Used unmodified. |
| `yandex.svg` | Yandex Browser | `https://commons.wikimedia.org/wiki/Special:FilePath/Yandex_Browser_icon.svg` | Per the [Commons file page](https://commons.wikimedia.org/wiki/File:Yandex_Browser_icon.svg): tagged `PD-logo` (public domain) and trademarked; origin given as `https://yandex.ru/support/`. |

The "public domain" tags above are Wikimedia Commons contributors' classifications, not statements by the trademark owners.

To regenerate the files run `npm run fetch:browser-icons`. `yandex.svg` differs from a fresh download only by a trailing newline.
