import {openAdbService} from './adb-bridge.js'
import type {AdbPool, FarmDevice, MaestroBaseline} from './types.js'
import {inspectMaestroDevice, prepareMaestroDevice, cleanupMaestroDevice}
  from '../../util/maestro-device.js'

/** Server-owned bounded commands; worker input never becomes a shell command here. */
export class MaestroDeviceAdapter {
  constructor(private readonly pools: AdbPool[]) {}

  private target(device: FarmDevice) {
    const pool = this.pools.find(item => item.provider === device.provider)
    if (device.platform !== 'Android' || !pool) {
 throw new Error('Maestro requires an Android ADB pool')
}
    return {leaseId: '', serial: device.serial, host: pool.host, port: pool.port}
  }

  private async shell(device: FarmDevice, command: string, acceptFailure = false) {
    const socket = await openAdbService(this.target(device),
      'shell:' + command + '; status=$?; printf \'\n__STF_EXIT__%s\n\' "$status"')
    const timer = setTimeout(() =>
      socket.destroy(new Error('Maestro cleanup command timed out')), 30000)
    timer.unref?.()
    try {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of socket) {
        length += chunk.length
        if (length > 1024 * 1024) {
 throw new Error('Maestro command output exceeded its limit')
}
        chunks.push(Buffer.from(chunk))
      }
      const result = Buffer.concat(chunks).toString('utf8').replace(/\r/g, '')
      const match = /\n__STF_EXIT__(\d+)\n$/.exec(result)
      if (!match || !acceptFailure && match[1] !== '0') {
 throw new Error('Maestro device command failed')
}
      return {output: result.slice(0, match.index).trim(), code: Number(match[1])}
    }
    finally {
      clearTimeout(timer)
      socket.destroy()
    }
  }

  baseline(device: FarmDevice): Promise<MaestroBaseline> {
    return inspectMaestroDevice(command =>
      this.shell(device, command).then(result => result.output))
  }

  prepare(device: FarmDevice): Promise<void> {
    return prepareMaestroDevice(command =>
      this.shell(device, command).then(result => result.output))
  }

  cleanup(device: FarmDevice, baseline: MaestroBaseline): Promise<void> {
    return cleanupMaestroDevice(command =>
      this.shell(device, command).then(result => result.output), baseline)
  }
}
