import type {ChildProcess} from 'child_process'
import type {Device} from '@devicefarmer/adbkit'

export interface ProviderOptions {
  name: string
  killTimeout: number
  ports: number[]
  filter?: (device: Device) => boolean
  allowRemote: boolean
  fork(device: Device, ports: number[]): ChildProcess
  endpoints: {
    sub: string[]
    push: string[]
  }
  adbHost: string
  adbPort: number
}
