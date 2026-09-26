import type {ComponentType} from 'react'
import {
  IconBrandAndroid
  , IconFile
  , IconFileCode
  , IconFileSpreadsheet
  , IconFileText
  , IconFileTypePdf
  , IconFileZip
  , IconFolderFilled
  , IconFolderSymlink
  , IconMovie
  , IconMusic
  , IconPhoto
} from '@tabler/icons-react'

export interface FileEntry {
  name: string
  mode: number
  size: number
  mtimeMs?: number
  mtime?: string
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

export function fileType(mode: number): number {
  return mode & S_IFMT
}

export function isSymlink(mode: number): boolean {
  return fileType(mode) === S_IFLNK
}

export function fileIsDir(mode: number | null | undefined): boolean {
  if (mode === null || mode === undefined) {
    return false
  }
  const type = fileType(Number(mode))
  return type === S_IFDIR || type === S_IFLNK
}

export function formatPermissionMode(mode: number | null | undefined): string {
  if (mode === null || mode === undefined) {
    return ''
  }
  const symbols = ['x', 'w', 'r']
  const bits: string[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      bits.unshift((mode >> (i * 3 + j)) & 1 ? symbols[j]! : '-')
    }
  }
  if (fileType(mode) === S_IFDIR) {
    bits.unshift('d')
  }
  else if (isSymlink(mode)) {
    bits.unshift('l')
  }
  else {
    bits.unshift('-')
  }
  return bits.join('')
}

export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} Kb`
  }
  return `${Math.round(size / (1024 * 1024))} Mb`
}

export function formatFileDate(value: number | string | undefined): string {
  if (value === undefined) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return date.toISOString().substring(0, 19).replace('T', ' ')
}

export function normalizePath(path: string): string {
  return `/${path}`.replace(/\/\/+/g, '/')
}

export function compareEntries(a: FileEntry, b: FileEntry): number {
  const dirOrder = Number(fileIsDir(b.mode)) - Number(fileIsDir(a.mode))
  if (dirOrder !== 0) {
    return dirOrder
  }
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

const extensionIcons: Array<[RegExp, ComponentType<{size?: number}>, string]> = [
  [/\.(png|jpe?g|gif|bmp|webp|svg|heic|ico)$/i, IconPhoto, 'teal']
  , [/\.(mp4|mkv|webm|avi|mov|3gp|m4v)$/i, IconMovie, 'grape']
  , [/\.(mp3|wav|ogg|flac|aac|m4a|opus|amr)$/i, IconMusic, 'pink']
  , [/\.(apk|aab|dex|odex|vdex|oat)$/i, IconBrandAndroid, 'green']
  , [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar|jar|img)$/i, IconFileZip, 'orange']
  , [/\.pdf$/i, IconFileTypePdf, 'red']
  , [/\.(csv|tsv|xlsx?|db|sqlite)$/i, IconFileSpreadsheet, 'lime']
  , [/\.(json|xml|js|ts|sh|rc|py|html?|css|java|kt|c|cpp|h)$/i, IconFileCode, 'indigo']
  , [/\.(txt|log|md|prop|conf|cfg|ini|properties)$/i, IconFileText, 'blue']
]

export function fileIcon(entry: FileEntry): {icon: ComponentType<{size?: number}>, color: string} {
  if (isSymlink(entry.mode)) {
    return {icon: IconFolderSymlink, color: 'yellow'}
  }
  if (fileIsDir(entry.mode)) {
    return {icon: IconFolderFilled, color: 'yellow'}
  }
  const match = extensionIcons.find(([pattern]) => pattern.test(entry.name))
  return match ? {icon: match[1], color: match[2]} : {icon: IconFile, color: 'gray'}
}
