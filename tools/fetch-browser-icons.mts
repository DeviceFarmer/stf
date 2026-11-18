#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '../res/common/browser-icons')

interface IconSource {
  filename: string
  url: string
  // When set, `url` is a ZIP archive and this is the path of the SVG inside it.
  zipEntry?: string
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
  , url: 'https://staticcdn.duckduckgo.com/press/DuckDuckGo-Brand-Logo.zip'
  , zipEntry: 'DuckDuckGo-Brand-Logo 2/Logo Files/SVG/DuckDuckGo Logo- Dax Solo.svg'
  }
, {
    filename: 'yandex.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Yandex_Browser_icon.svg'
  }
]

// Minimal ZIP reader (stored/deflate entries, no ZIP64) so that no extra
// dependency or external `unzip` binary is needed.
function readZipEntry(zip: Buffer, entryName: string): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) {
    throw new Error('Not a ZIP archive: end of central directory not found')
  }
  const count = zip.readUInt16LE(eocd + 10)
  let pos = zip.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error('Corrupt ZIP central directory')
    }
    const method = zip.readUInt16LE(pos + 10)
    const compressedSize = zip.readUInt32LE(pos + 20)
    const nameLength = zip.readUInt16LE(pos + 28)
    const extraLength = zip.readUInt16LE(pos + 30)
    const commentLength = zip.readUInt16LE(pos + 32)
    const localOffset = zip.readUInt32LE(pos + 42)
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLength)

    if (name === entryName) {
      const dataStart = localOffset + 30 +
        zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
      const data = zip.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) {
        return data.toString('utf8')
      }
      if (method === 8) {
        return zlib.inflateRawSync(data).toString('utf8')
      }
      throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}`)
    }

    pos += 46 + nameLength + extraLength + commentLength
  }

  throw new Error(`${entryName} not found in ZIP archive`)
}

async function fetchIcon(source: IconSource) {
  process.stdout.write(`Fetching ${source.filename} from ${source.url}... `)
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'stf-fetch-browser-icons (+https://github.com/DeviceFarmer/stf)'
    }
  , redirect: 'follow'
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.url}: HTTP ${response.status} ${response.statusText}`)
  }

  let text = source.zipEntry ?
    readZipEntry(Buffer.from(await response.arrayBuffer()), source.zipEntry) :
    await response.text()
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
