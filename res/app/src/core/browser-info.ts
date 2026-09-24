function detectOs(): 'android' | 'ios' | 'pc' {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) {
    return 'android'
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'ios'
  }
  return 'pc'
}

const touch = 'ontouchstart' in window
const small = Math.min(window.screen.width, window.outerWidth || window.screen.width) < 800
const os = detectOs()

export const browserInfo = {
  touch
  , small
  , os
  , mobile: small && touch && os !== 'pc'
  , deviceorientation: 'DeviceOrientationEvent' in window
}
