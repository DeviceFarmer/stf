#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '../res/common/browser-icons')

interface IconSource {
  filename: string
  url: string
  // Turns the downloaded text into the SVG to write, before it is checked.
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
    // Apache-2.0, unlike the press kit's CC BY-NC-ND 4.0 copy of the same logo. Pinned to a
    // commit so a regenerated file only changes when this line does.
    filename: 'duckduckgo.svg'
  , url: 'https://raw.githubusercontent.com/duckduckgo/Android/7efc550b74a91a1ad20b6af300f0331d8a6af943/android-design-system/design-system/src/main/res/drawable/ic_dax_icon.xml'
  , transform: (xml) => vectorDrawableToSvg(xml, 'Converted to SVG from ic_dax_icon.xml in ' +
      'https://github.com/duckduckgo/Android. Copyright (c) 2021 Duck Duck Go, Inc. Apache-2.0.')
  }
, {
    filename: 'yandex.svg'
  , url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Yandex_Browser_icon.svg'
  }
]

function xmlAttributes(tag: string): Map<string, string> {
  return new Map(Array.from(tag.matchAll(/([\w:]+)="([^"]*)"/g), (m) => [m[1]!, m[2]!]))
}

// Android colors are #RGB, #ARGB, #RRGGBB or #AARRGGBB; SVG wants the alpha apart.
function androidColor(value: string): {color: string, opacity?: number} {
  const hex = value.replace(/^#/, '')
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) {
    throw new Error(`Unsupported color ${value}`)
  }
  const full = hex.length <= 4 ? hex.replace(/./g, '$&$&') : hex
  if (full.length === 6) {
    return {color: `#${full}`}
  }
  return {color: `#${full.slice(2)}`, opacity: parseInt(full.slice(0, 2), 16) / 255}
}

// Converts an Android VectorDrawable made only of plain paths, which is all the icons used here
// need. Anything else (groups, clip paths, gradients) fails instead of being dropped silently.
// `notice` goes into the SVG as a comment, as Apache-2.0 asks of changed files.
function vectorDrawableToSvg(xml: string, notice: string): string {
  // A comment could hide tags from the matching below, and the drawables used here have none
  if (xml.includes('<!--')) {
    throw new Error('Unsupported VectorDrawable: contains an XML comment')
  }
  const body = xml.replace(/<\?xml[^>]*\?>/, '')
  const tags = Array.from(body.matchAll(/<([\w:]+)\b[^>]*>/g))
  const vector = tags[0]
  if (!vector || vector[1] !== 'vector') {
    throw new Error('Not a VectorDrawable: <vector> root not found')
  }
  const unsupported = tags.slice(1).filter((tag) => tag[1] !== 'path')
  if (unsupported.length > 0) {
    throw new Error(`Unsupported VectorDrawable element <${unsupported[0]![1]}>`)
  }

  const root = xmlAttributes(vector[0])
  const viewBox = `0 0 ${root.get('android:viewportWidth')} ${root.get('android:viewportHeight')}`
  const paths = tags.slice(1).map((tag) => {
    const attrs = xmlAttributes(tag[0])
    const out: string[] = [`d="${attrs.get('android:pathData')}"`]
    const fill = attrs.get('android:fillColor')
    let fillOpacity = Number(attrs.get('android:fillAlpha') ?? 1)
    if (fill) {
      const parsed = androidColor(fill)
      out.push(`fill="${parsed.color}"`)
      fillOpacity *= parsed.opacity ?? 1
    }
    else {
      out.push('fill="none"')
    }
    if (fillOpacity !== 1) {
      out.push(`fill-opacity="${+fillOpacity.toFixed(4)}"`)
    }
    if (attrs.get('android:fillType') === 'evenOdd') {
      out.push('fill-rule="evenodd"')
    }
    // strokeAlpha alone draws nothing: without strokeColor there is no stroke
    const stroke = attrs.get('android:strokeColor')
    if (stroke) {
      const parsed = androidColor(stroke)
      const strokeOpacity = Number(attrs.get('android:strokeAlpha') ?? 1) * (parsed.opacity ?? 1)
      out.push(`stroke="${parsed.color}"`, `stroke-width="${attrs.get('android:strokeWidth') ?? 0}"`)
      if (strokeOpacity !== 1) {
        out.push(`stroke-opacity="${+strokeOpacity.toFixed(4)}"`)
      }
    }
    const known = ['android:pathData', 'android:fillColor', 'android:fillAlpha', 'android:fillType'
    , 'android:strokeColor', 'android:strokeWidth', 'android:strokeAlpha']
    const unknown = Array.from(attrs.keys()).filter((name) => !known.includes(name))
    if (unknown.length > 0) {
      throw new Error(`Unsupported VectorDrawable path attribute ${unknown[0]}`)
    }
    return `  <path ${out.join(' ')}/>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n<!-- ${notice} -->\n` +
    `${paths.join('\n')}\n</svg>\n`
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

  let text = await response.text()
  if (source.transform) {
    text = source.transform(text)
  }

  if (!text.includes('<svg')) {
    throw new Error(`Invalid response for ${source.filename}: does not contain <svg tag`)
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
