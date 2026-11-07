#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '../res/common/browser-icons')

interface IconSource {
  filename: string
  url: string
  transform?: (raw: string) => string
}

const SOURCES: IconSource[] = [
  {
    filename: 'chrome.svg'
  , url: 'https://www.google.com/chrome/static/images/chrome-logo.svg'
  }
, {
    filename: 'chromium.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Chromium_11_Logo.svg'
  }
, {
    filename: 'firefox.svg'
  , url: 'https://raw.githubusercontent.com/mozilla/protocol-assets/main/logos/firefox/browser/logo.svg'
  }
, {
    filename: 'brave.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Brave_lion_icon.svg'
  }
, {
    filename: 'vivaldi.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Vivaldi_web_browser_logo.svg'
  }
, {
    filename: 'opera.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Opera_2015_icon.svg'
  }
, {
    filename: 'edge.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Microsoft_Edge_logo_(2019).svg'
  }
, {
    filename: 'samsung.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Samsung_Internet_logo.svg'
  }
, {
    filename: 'duckduckgo.svg'
  , url: 'https://upload.wikimedia.org/wikipedia/en/1/15/DuckDuckGo_logo_post-2023.svg'
  , transform: (svg: string) => {
      // Remove wordmark text path below the icon and constrain viewBox to the circular Dax icon
      const withoutWordmark = svg.replace(/<path fill="#333" d="[^"]+"><\/path>/, '')
      return withoutWordmark
        .replace('viewBox="0 0 184 148"', 'viewBox="38.385 0 107.122 107.122"')
        .replace(/height="[^"]+" width="[^"]+"/, 'width="100%" height="100%"')
    }
  }
, {
    filename: 'yandex.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Yandex_Browser_icon.svg'
  }
]

async function fetchIcon(source: IconSource) {
  process.stdout.write(`Fetching ${source.filename} from ${source.url}... `)
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    }
  , redirect: 'follow'
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.url}: HTTP ${response.status} ${response.statusText}`)
  }

  let text = await response.text()
  if (!text.includes('<svg')) {
    throw new Error(`Invalid response for ${source.filename}: does not contain <svg tag`)
  }

  if (source.transform) {
    text = source.transform(text)
  }

  if (!text.includes('viewBox=')) {
    throw new Error(`Invalid SVG for ${source.filename}: missing viewBox attribute`)
  }

  const dest = path.join(OUTPUT_DIR, source.filename)
  await fs.writeFile(dest, text, 'utf8')
  console.log('✓ OK')
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, {recursive: true})
  console.log(`Downloading official browser SVGs into ${OUTPUT_DIR}...\n`)

  for (const source of SOURCES) {
    await fetchIcon(source)
  }

  console.log(`\nAll ${SOURCES.length} browser icons updated successfully.`)
}

main().catch((err) => {
  console.error('\nError fetching browser icons:', err)
  process.exit(1)
})
