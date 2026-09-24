import {useCallback, useEffect, useRef, useState} from 'react'
import type {Control} from '@/core/control'

export function useDeviceValue<T>(control: Control, read: (control: Control) => Promise<T>) {
  const [value, setValue] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const active = useRef(true)

  const reload = useCallback(() => {
    setLoading(true)
    read(control)
      .then((next) => {
        if (active.current) {
          setValue(next)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active.current) {
          setLoading(false)
        }
      })
  }, [control, read])

  useEffect(() => {
    active.current = true
    reload()
    return () => {
      active.current = false
    }
  }, [reload])

  return {value, setValue, loading, reload, active}
}
