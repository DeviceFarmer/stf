import {execFile, spawn, type ChildProcess} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {iosDeviceId, parseIosConfig, type IosConfig} from '../../util/ios-config.js'

interface LocalOptions {
  configFile: string
  stateDirectory?: string
  apiPort: number
  storagePort: number
  push: string
  sub: string
  excludedPorts: number[]
}

function execute(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {timeout: 10000}, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
      }
      else {
        resolve(stdout.trim())
      }
    })
  })
}

export async function reserveIosPorts(count: number, excluded: number[] = []) {
  const reservations: net.Server[] = []
  const ports: number[] = []
  const release = async() => {
    await Promise.all(reservations.map(server => new Promise<void>(resolve => server.close(() =>
      resolve()))))
    reservations.length = 0
  }
  try {
    while (ports.length < count) {
      const server = net.createServer()
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '0.0.0.0', resolve)
      })
      const port = (server.address() as net.AddressInfo).port
      if (excluded.includes(port)) {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
      else {
        reservations.push(server)
        ports.push(port)
      }
    }
    return {ports, release}
  }
  catch (error) {
    await release()
    throw error
  }
}

export function nativeIosCommands(device: IosConfig['devices'][number], options: {
  ports: number[]
  directory: string
  tokenFile: string
  publicOrigin: string
  apiPort: number
  storagePort: number
  push: string
  sub: string
  node: string
  ios: string
  root: string
}) {
  const [api, wda, mjpeg, tunnel, screen] = options.ports
  const helper = path.join(options.root, 'tools/ios-prototype/container.mts')
  const runtime = path.join(options.root, 'tools/ios-prototype/main.mts')
  const cli = path.join(options.root, 'lib/cli/index.js')
  const tunnelArgs = [options.node, helper, 'native-tunnel', options.ios
    , '--udid=' + device.udid, '--tunnel-info-port=' + tunnel, 'tunnel', 'start'
    , '--pair-record-path=' + path.join(options.directory, 'pairing')]
  return {
    tunnel: process.getuid?.() === 0 ? tunnelArgs : ['sudo', '-n', '--', ...tunnelArgs]
  , runtime: [options.node, runtime, '--udid=' + device.udid
    , '--wda-bundle-id=' + device.wdaBundleId, '--image-mounter=pymobiledevice3'
    , '--go-ios=' + options.ios, '--port=' + api, '--wda-port=' + wda
    , '--mjpeg-port=' + mjpeg, '--tunnel-port=' + tunnel, '--token-file=' + options.tokenFile
    , '--state-dir=' + path.join(options.directory, 'device')
    , '--install-dir=' + path.join(options.directory, 'installations')
    , '--storage-url=http://127.0.0.1:' + options.storagePort + '/']
  , provider: [options.node, cli, 'ios-provider', '--serial=' + device.udid
    , '--token-file=' + options.tokenFile, '--prototype-url=http://127.0.0.1:' + api
    , '--screen-port=' + screen, '--api-url=http://127.0.0.1:' + options.apiPort
    , '--public-origin=' + options.publicOrigin
    , '--storage-url=http://127.0.0.1:' + options.storagePort + '/'
    , '--screen-url=' + options.publicOrigin.replace('http:', 'ws:') +
      '/ios/' + iosDeviceId(device.udid) + '/screen'
    , '--connect-push=' + options.push, '--connect-sub=' + options.sub
    , '--name=Local iOS', '--market-name=' + (device.name || '')]
  , screenTarget: 'http://127.0.0.1:' + screen + '/'
  }
}

export async function prepareLocalIos(options: LocalOptions) {
  if (process.platform !== 'linux') {
    throw new Error('--ios-config requires the Linux USB host; use Compose on a Linux VM')
  }
  const config = parseIosConfig(JSON.parse(await fs.readFile(options.configFile, 'utf8')))
  if (new URL(config.publicOrigin).protocol !== 'http:') {
    throw new Error('stf local requires an http:// publicOrigin')
  }
  const ios = await execute('which', ['ios'])
  await execute('iproxy', ['--version'])
  await execute('pymobiledevice3', ['version'])
  await fs.access('/dev/net/tun')
  if (process.getuid?.() !== 0) {
    try {
      await execute('sudo', ['-n', 'true'])
    }
    catch {
      throw new Error('The iOS tunnel needs root: run sudo -v in this terminal before stf local')
    }
  }
  const directory = path.resolve(options.stateDirectory ||
    path.join(os.homedir(), '.stf-ios-local'))
  await fs.mkdir(directory, {recursive: true, mode: 0o700})
  if (!(await fs.lstat(directory)).isDirectory()) {
    throw new Error('The iOS state directory must not be a symlink')
  }
  await fs.chmod(directory, 0o700)
  const proxyPort = Number(new URL(config.publicOrigin).port || 80)
  const reservation = await reserveIosPorts(config.devices.length * 5
    , [...options.excludedPorts, proxyPort])
  const root = path.resolve(import.meta.dirname, '../../..')
  const routes: Record<string, string> = {}
  const commands: Array<{name: string, args: string[], privileged: boolean}> = []
  try {
    for (const [index, device] of config.devices.entries()) {
      const id = iosDeviceId(device.udid)
      const deviceDirectory = path.join(directory, id)
      await fs.mkdir(path.join(deviceDirectory, 'pairing'), {recursive: true, mode: 0o700})
      const tokenFile = path.join(deviceDirectory, 'api.token')
      try {
        await fs.writeFile(tokenFile, randomBytes(32).toString('hex') + '\n'
          , {flag: 'wx', mode: 0o600})
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }
      }
      if (!(await fs.lstat(tokenFile)).isFile()) {
        throw new Error('The iOS token must be a regular file')
      }
      await fs.chmod(tokenFile, 0o600)
      const selected = nativeIosCommands(device, {...options, directory: deviceDirectory
        , ports: reservation.ports.slice(index * 5, index * 5 + 5), tokenFile
        , publicOrigin: config.publicOrigin, node: process.execPath, ios, root})
      routes['/ios/' + id + '/screen'] = selected.screenTarget
      for (const role of ['tunnel', 'runtime', 'provider'] as const) {
        commands.push({name: id + ':' + role, args: selected[role], privileged: role === 'tunnel'})
      }
    }
  }
  catch (error) {
    await reservation.release()
    throw error
  }
  let stopping = false
  let started = false
  const children = new Map<ChildProcess, boolean>()
  const loops: Promise<void>[] = []
  const waiters = new Set<() => void>()
  const restart = async(command: typeof commands[number]) => {
    while (!stopping) {
      const [binary, ...args] = command.args
      const child = spawn(binary!, args, {stdio: ['pipe', 'inherit', 'inherit']})
      children.set(child, command.privileged)
      child.stdin!.on('error', () => {})
      await new Promise<void>(resolve => {
        child.once('error', error => {
          process.stderr.write(command.name + ': ' + error.message + '\n')
        })
        child.once('close', () => resolve())
      })
      children.delete(child)
      if (!stopping) {
        process.stderr.write(command.name + ' exited; retrying in 5 seconds\n')
        await new Promise<void>(resolve => {
          const finish = () => {
            clearTimeout(timer)
            waiters.delete(finish)
            resolve()
          }
          const timer = setTimeout(finish, 5000)
          waiters.add(finish)
        })
      }
    }
  }
  return {
    config, routes
  , async start() {
      if (started || stopping) {
        throw new Error('The local iOS fleet cannot be started twice')
      }
      started = true
      await reservation.release()
      for (const command of commands) {
        loops.push(restart(command))
      }
    }
  , async stop() {
      stopping = true
      await reservation.release()
      for (const wake of waiters) {
        wake()
      }
      for (const [child, privileged] of children) {
        // EOF reaches the sudo-owned tunnel helper, which stops its root child.
        child.stdin?.end()
        if (!privileged) {
          child.kill('SIGTERM')
        }
      }
      const timer = setTimeout(() => {
        for (const [child, privileged] of children) {
          if (!privileged) {
            child.kill('SIGKILL')
          }
        }
      }, 10000)
      try {
        await Promise.all(loops)
      }
      finally {
        clearTimeout(timer)
      }
    }
  }
}
