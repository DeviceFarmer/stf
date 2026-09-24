import type {Control} from '@/core/control'
import {gettext} from '@/core/i18n'

interface LegacyKeyboardEvent extends KeyboardEvent {
  keyIdentifier?: string
}

const charsetKeys = ['Convert', 'Alphanumeric', 'RomanCharacters', 'KanjiMode']

function isChangeCharsetKey(e: LegacyKeyboardEvent): boolean {
  if (
    e.keyCode === 0 && e.keyIdentifier === 'U+0010' ||
    e.keyCode === 0 && e.keyIdentifier === 'U+0020' ||
    e.keyCode === 246 && e.keyIdentifier === 'U+00F6' ||
    e.keyCode === 28 && e.keyIdentifier === 'U+001C'
  ) {
    return true
  }
  return charsetKeys.includes(e.key)
}

export function bindScreenKeyboard(input: HTMLInputElement, control: Control): () => void {
  let clipboardContent: string | null = null

  function handleSpecialKeys(e: KeyboardEvent): boolean {
    if (isChangeCharsetKey(e)) {
      e.preventDefault()
      control.keyPress('switch_charset')
      return true
    }
    return false
  }

  function getClipboardContent() {
    control.copy()
      .then((result) => {
        if (result.success) {
          clipboardContent = result.lastData ? String(result.lastData) : gettext('No clipboard data')
        }
        else {
          clipboardContent = gettext('Error while getting data')
        }
      })
      .catch(() => {
        clipboardContent = gettext('Error while getting data')
      })
  }

  function keydownListener(e: KeyboardEvent) {
    if (e.keyCode === 9) {
      e.preventDefault()
    }
    control.keyDown(e.keyCode)
  }

  function keyupListener(e: KeyboardEvent) {
    if (!handleSpecialKeys(e)) {
      control.keyUp(e.keyCode)
    }
  }

  function pasteListener(e: ClipboardEvent) {
    e.preventDefault()
    control.paste(e.clipboardData ? e.clipboardData.getData('text/plain') : '')
      .catch(() => undefined)
  }

  function copyListener(e: ClipboardEvent) {
    e.preventDefault()
    getClipboardContent()
    if (clipboardContent && e.clipboardData) {
      e.clipboardData.setData('text/plain', clipboardContent)
    }
  }

  function inputListener() {
    control.type(input.value)
    input.value = ''
  }

  input.addEventListener('keydown', keydownListener)
  input.addEventListener('keyup', keyupListener)
  input.addEventListener('input', inputListener)
  input.addEventListener('paste', pasteListener)
  input.addEventListener('copy', copyListener)

  return () => {
    input.removeEventListener('keydown', keydownListener)
    input.removeEventListener('keyup', keyupListener)
    input.removeEventListener('input', inputListener)
    input.removeEventListener('paste', pasteListener)
    input.removeEventListener('copy', copyListener)
  }
}
