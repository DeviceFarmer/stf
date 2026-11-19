import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

type Theme = 'light' | 'dark'
type Size = 16 | 28 | 88

const {values} = parseArgs({
  options: {
    sharp: {type: 'string'}
  , output: {type: 'string'}
  }
})

const require = createRequire(import.meta.url)
const sharp = require(values.sharp ? path.resolve(values.sharp) : 'sharp')
const sharpVersion = '0.35.5'
if (sharp.versions.sharp !== sharpVersion) {
  throw new Error(`Use Sharp ${sharpVersion} to regenerate the logo assets`)
}

const logoDirectory = fileURLToPath(new URL('../res/common/logo/', import.meta.url))
const output = values.output ? path.resolve(values.output) : logoDirectory
const exportsDirectory = path.join(output, 'exports/restored')

const source = await fs.readFile(path.join(logoDirectory, 'STF-lettering.svg'), 'utf8')
const outlines = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1]?.trim()
if (!outlines) {
  throw new Error('Missing outlines in STF-lettering.svg')
}

const colors = [
  '#FF6460', '#FF965B', '#FBC14D', '#F4DC62', '#B6DF7A', '#56D89C', '#55C9F5', '#EC7ABC'
]
const divider = '#EFF2F8'
const branches = '#CED5E1'
const frameDurations = [1450, ...Array<number>(43).fill(50)]

function rect(x: number, y: number, w: number, h: number, radius: number,
  fill: string, stroke?: string, strokeWidth = 1) {
  const border = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ''
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"${border}/>`
}

function lettering(size: Size) {
  const tiny = size === 16
  const y = tiny ? 154 : 160
  const scale = tiny ? '1.18 1.10' : '1.035 1'
  const stroke = tiny ? ' stroke="#FFFFFF" stroke-width="4.25" stroke-linejoin="round"' : ''
  return `<g fill="#FFFFFF"${stroke} transform="translate(256 ${y}) scale(${scale}) translate(-256.72 -160.8)">
    ${outlines}
  </g>`
}

function plate(theme: Theme, size: Size, frame: number) {
  const dark = theme === 'dark'
  const tiny = size === 16
  const inset = tiny ? 31 : 17
  const width = tiny ? 450 : 478
  const radius = tiny ? 40 : 32
  const border = dark ? '#626A78' : '#4A4E57'
  const base = rect(inset, inset, width, width, radius, dark ? '#373B44' : '#33363E',
    tiny && !dark ? '' : border, tiny ? 6 : 3)
  if (frame === 0) {
    return base
  }

  const phase = frame / frameDurations.length
  const sweepX = -212 + 936 * phase * phase * (3 - 2 * phase)
  return `
    <defs>
      <linearGradient id="sweep" gradientUnits="userSpaceOnUse" x1="${sweepX - 174}" y1="174" x2="${sweepX + 174}" y2="338">
        <stop offset="0" stop-color="#A0C7FF" stop-opacity="0"/>
        <stop offset=".18" stop-color="#A0C7FF" stop-opacity=".026"/>
        <stop offset=".33" stop-color="#A7C7FF" stop-opacity=".10"/>
        <stop offset=".46" stop-color="#DEE9FF" stop-opacity=".25"/>
        <stop offset=".54" stop-color="#EBF3FF" stop-opacity=".27"/>
        <stop offset=".67" stop-color="#B7D3FF" stop-opacity=".13"/>
        <stop offset=".82" stop-color="#A0C7FF" stop-opacity=".046"/>
        <stop offset="1" stop-color="#A0C7FF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${base}
    ${rect(inset, inset, width, width, radius, 'url(#sweep)')}`
}

function faviconRack() {
  const centers = [80, 112, 176, 208, 304, 336, 400, 432]
  const stems = centers.map(x => ` M${x} 329V384`).join('')
  return `
    ${rect(64, 264, 384, 20, 4, divider)}
    <path d="M256 280V329 M80 329H432${stems}"
      fill="none" stroke="${branches}" stroke-width="14" stroke-linecap="round"/>
    ${centers.map((x, index) => rect(x - 16, 384, 32, 64, 5, colors[index]!)).join('')}`
}

function rack(size: 28 | 88) {
  const compact = size === 28
  const centers = colors.map((_, index) => 88 + 48 * index)
  const stems = centers.map(x => ` M${x} 333V385`).join('')
  const devices = centers.map((center, index) => {
    const x = center - 17
    const color = colors[index]!
    if (compact) {
      return rect(x, 379, 34, 63, 6, color)
    }
    return rect(x, 379, 34, 63, 7, '#EFF2F7')
      + rect(x + 4.5, 383.5, 25, 54, 4, color)
  })
  return `
    ${rect(62, 271, 388, compact ? 10 : 7.5, 3.5, divider)}
    <path d="M256 275V333 M88 333H424${stems}"
      fill="none" stroke="${branches}" stroke-width="${compact ? 8.5 : 5.75}" stroke-linecap="round"/>
    ${devices.join('')}`
}

function render(theme: Theme, size: Size, pixels: number, frame = 0) {
  const elements = [
    plate(theme, size, frame)
  , lettering(size)
  , size === 16 ? faviconRack() : rack(size)
  ].map(element => element.trim())
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"
  width="${pixels}" height="${pixels}">
  ${elements.join('\n  ')}
</svg>\n`
}

function raster(theme: Theme, size: Size, pixels: number, frame = 0) {
  // Rasterize from the vector for each density. Retain the artwork for the logical size.
  return sharp(Buffer.from(render(theme, size, pixels, frame))).ensureAlpha()
}

async function writeWebp(theme: Theme, size: 28 | 88, pixels: number, file: string) {
  const frames = await Promise.all(frameDurations.map((_, index) =>
    raster(theme, size, pixels, index).raw().toBuffer()
  ))
  await sharp(Buffer.concat(frames), {
    raw: {width: pixels, height: pixels * frames.length, channels: 4, pageHeight: pixels}
  }).webp({delay: frameDurations, loop: 0, lossless: true, effort: 6}).toFile(file)
}

async function writeFavicon() {
  const sizes = [16, 32]
  const pngs = await Promise.all(sizes.map(size => raster('light', 16, size).png().toBuffer()))
  // An ICO header and directory pointing to two complete PNG images.
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16
    const bytes = pngs[index]!.length
    header[entry] = size
    header[entry + 1] = size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(bytes, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += bytes
  }
  await fs.writeFile(path.join(exportsDirectory, 'favicon.ico'), Buffer.concat([header, ...pngs]))
}

await fs.mkdir(exportsDirectory, {recursive: true})
await fs.writeFile(path.join(output, 'STF-restored.svg'), render('light', 88, 512))
for (const theme of ['light', 'dark'] as const) {
  for (const size of [16, 28, 88] as const) {
    for (const density of size === 16 ? [1] : [1, 2]) {
      const pixels = size * density
      const filename = path.join(exportsDirectory, `STF-${size}-${theme}${density === 2 ? '@2x' : ''}`)
      await raster(theme, size, pixels).png().toFile(filename + '.png')
      if (size !== 16) {
        await writeWebp(theme, size, pixels, filename + '.webp')
      }
    }
  }
}
await writeFavicon()
