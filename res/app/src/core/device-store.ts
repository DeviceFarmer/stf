import {create} from 'zustand'

export function createDeviceStore<T>(initial: T) {
  const store = create<Record<string, T>>(() => ({}))

  function get(serial: string): T {
    return store.getState()[serial] ?? initial
  }

  return {
    get
    , useValue: (serial: string): T => store((state) => state[serial] ?? initial)
    , set: (serial: string, value: T) => store.setState({[serial]: value})
    , update: (serial: string, updater: (current: T) => T) =>
      store.setState({[serial]: updater(get(serial))})
  }
}
