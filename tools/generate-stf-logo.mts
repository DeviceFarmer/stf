import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

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
const exportsDirectory = path.join(output, 'exports')
const source = await fs.readFile(path.join(logoDirectory, 'devicefarmer.svg'), 'utf8')

// The square source already centers the symbol. Remove just the DEVICE and FARMER outlines.
const wordmark = /^[ \t]*<path class="fil12" d="M(?:1253\.89 1358\.93|1232\.29 1582\.66)[^"]+"\/>\n/gm
if (source.match(wordmark)?.length !== 2) {
  throw new Error('Expected both DeviceFarmer wordmark paths in the source SVG')
}
const icon = source.replace(wordmark, '').replace(/^<!DOCTYPE svg [^\n]+\n/m, '')

function raster(svg: string, pixels: number) {
  const sourceSize = 'width="512" height="512"'
  if (!svg.includes(sourceSize)) {
    throw new Error('Expected a 512 px square DeviceFarmer source SVG')
  }
  const sized = svg.replace(sourceSize, `width="${pixels}" height="${pixels}"`)
  return sharp(Buffer.from(sized)).png()
}

async function writeFavicon() {
  const sizes = [16, 32]
  const pngs = await Promise.all(sizes.map(size => raster(icon, size).toBuffer()))
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
await fs.writeFile(path.join(output, 'devicefarmer-icon.svg'), icon)
for (const size of [28, 88]) {
  const svg = size === 28 ? icon : source
  for (const density of [1, 2]) {
    const suffix = density === 2 ? '@2x' : ''
    await raster(svg, size * density).toFile(path.join(exportsDirectory, `devicefarmer-${size}${suffix}.png`))
  }
}
await raster(icon, 180).toFile(path.join(exportsDirectory, 'devicefarmer-180.png'))
await writeFavicon()
