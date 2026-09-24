import {useEffect} from 'react'
import {browserInfo} from '@/core/browser-info'
import type {Control} from '@/core/control'

export function useGuestOrientation(control: Control) {
  useEffect(() => {
    if (!browserInfo.deviceorientation) {
      return undefined
    }

    function guestDisplayRotated() {
      if (window.innerHeight > window.innerWidth) {
        control.rotate(0)
      }
      else {
        window.scrollTo(0, 0)
        control.rotate(90)
      }
    }

    window.addEventListener('orientationchange', guestDisplayRotated, true)
    return () => window.removeEventListener('orientationchange', guestDisplayRotated, true)
  }, [control])
}
