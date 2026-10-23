import {spawn, execFile} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {parseIosConfig, iosDeviceId} from '../../lib/util/ios-config.ts'
import {probeSocket} from './container.mts'
import {renderIosCompose, renderIosNginx, type ComposeDocument} from './compose-config.mts'

const repository = fileURLToPath(new URL('../../', import.meta.url))

export function capture(binary: string, args: string[], env = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {cwd: repository, env, timeout: 30000, maxBuffer: 4 * 1024 * 1024}
      , (error, stdout, stderr) => {
        if (error) {
          reject(new Error(binary + ': ' + (stderr.trim().slice(-2000) || error.message)))
        }
        else {
          resolve(stdout)
        }
      })
  })
}

async function run(args: string[], env = process.env) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, {cwd: repository, env, stdio: 'inherit'})
    const stop = () => child.kill('SIGINT')
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    child.once('error', reject)
    child.once('close', code => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      if (code === 0) {
        resolve()
      }
      else {
        reject(new Error('Docker exited with status ' + code))
      }
    })
  })
}

async function checkEngine() {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ?
    process.env.DOCKER_HOST : JSON.parse(await capture('docker', [
      'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'
    ])) as string
  if (!endpoint.startsWith('unix://')) {
    throw new Error('Run on the USB host with a local Docker Engine, not a remote Docker context')
  }
  const info = JSON.parse(await capture('docker', ['info', '--format', '{{json .}}']))
  const rootless = info.SecurityOptions?.some((s: string) => s.includes('rootless'))
  if (info.OSType !== 'linux' || rootless) {
    throw new Error('Use a rootful Linux Docker Engine for the USB tunnel')
  }
  return {os: info.OperatingSystem, architecture: info.Architecture}
}

async function privateDirectory(directory: string) {
  await fs.mkdir(directory, {recursive: true, mode: 0o700})
  if (!(await fs.lstat(directory)).isDirectory()) {
    throw new Error('The state directory must be a real directory, not a symlink')
  }
  await fs.chmod(directory, 0o700)
}

async function secretFile(filename: string, mode: number) {
  try {
    await fs.writeFile(filename, randomBytes(32).toString('hex') + '\n', {flag: 'wx', mode})
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  if (!(await fs.lstat(filename)).isFile()) {
    throw new Error('A private token must be a regular file, not a symlink')
  }
  await fs.chmod(filename, mode)
  const secret = (await fs.readFile(filename, 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/.test(secret)) {
    throw new Error('Invalid persisted secret in ' + filename)
  }
  return secret
}

function composeDollars(value: unknown, encode: boolean): unknown {
  if (typeof value === 'string') {
    return encode ? value.replaceAll('$', () => '$$') : value.replaceAll('$$', '$')
  }
  if (Array.isArray(value)) {
    return value.map(item => composeDollars(item, encode))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, composeDollars(item, encode)]))
  }
  return value
}

async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    config: {type: 'string'}
  , 'state-dir': {type: 'string'}
  , project: {type: 'string', default: 'stf-ios'}
  , 'stf-image': {type: 'string', default: 'stf-local:ios'}
  , 'ios-image': {type: 'string', default: 'stf-ios-runtime:local'}
  , socket: {type: 'string', default: '/run/usbmuxd'}
  , 'no-build': {type: 'boolean', default: false}
  , help: {type: 'boolean', short: 'h'}
  }})
  const [command, ...extra] = positionals
  if (values.help || !command) {
    process.stdout.write(`Usage: node tools/ios-prototype/compose.mts COMMAND [options]
Commands:
  build     Build STF and the Linux iOS tools image from this checkout
  prepare   Generate private Compose configuration from --config FILE
  up        Build and start the local stack (--no-build uses existing images)
  doctor    Check Linux/Docker/USB and list devices; --config checks selected phones
  status    Show the previously prepared stack
  logs      Follow its logs
  down      Stop the stack, retaining database, pairing and device state
Options:
  --config FILE       iOS JSON configuration (required by prepare/up)
  --state-dir DIR     Private generated configuration and tokens
  --project NAME      Compose project (default stf-ios)
  --stf-image IMAGE   STF image (default stf-local:ios)
  --ios-image IMAGE   Tools image (default stf-ios-runtime:local)
  --socket PATH       Host usbmuxd socket (default /run/usbmuxd)
Run on the Linux machine to which the iPhones are connected.
`)
    return
  }
  const commands = ['build', 'prepare', 'up', 'doctor', 'status', 'logs', 'down']
  if (extra.length || !commands.includes(command)) {
    throw new Error('Unknown command or unexpected positional arguments; use --help')
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(values.project) ||
      !path.isAbsolute(values.socket)) {
    throw new Error('Use a lowercase Compose project name and an absolute socket path')
  }
  for (const image of [values['stf-image'], values['ios-image']]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,254}$/.test(image)) {
      throw new Error('Invalid image reference')
    }
  }
  const directory = path.resolve(values['state-dir'] ||
    path.join(os.homedir(), '.stf-ios-compose', values.project))
  const generated = path.join(directory, 'compose.json')
  const compose = ['compose', '--project-name', values.project, '--file', generated]
  const config = values.config ?
    parseIosConfig(JSON.parse(await fs.readFile(path.resolve(values.config), 'utf8'))) : undefined
  if (command === 'doctor') {
    const checks: Array<{name: string, passed: boolean, detail: unknown}> = []
    const check = async(name: string, action: () => Promise<unknown>) => {
      try {
        checks.push({name, passed: true, detail: await action()})
      }
      catch (error) {
        checks.push({name, passed: false, detail: (error as Error).message})
      }
    }
    checks.push({name: 'linux', passed: process.platform === 'linux', detail: process.platform})
    await check('compose', () => capture('docker', ['compose', 'version', '--short']))
    await check('docker', checkEngine)
    await check('tun', async() => {
      if (!(await fs.stat('/dev/net/tun')).isCharacterDevice()) {
        throw new Error('/dev/net/tun must be a character device')
      }
      return '/dev/net/tun'
    })
    await check('usbmuxd', async() => {
      if (!(await probeSocket(values.socket))) {
        throw new Error('Start host usbmuxd, connect/unlock the iPhone and confirm computer trust')
      }
      return values.socket
    })
    const ios = (args: string[]) => capture('docker', ['run', '--rm', '--pull=never'
      , '--network', 'none'
      , '--mount', 'type=bind,src=' + values.socket + ',dst=/run/usbmuxd,readonly'
      , '--entrypoint', 'ios', values['ios-image'], ...args])
    await check('devices', async() => JSON.parse(await ios(['list'])))
    for (const device of config?.devices || []) {
      await check(device.udid + ':trust', async() => {
        const info = JSON.parse(await ios(['--udid=' + device.udid, 'info']))
        return {name: info.DeviceName, model: info.ProductType, ios: info.ProductVersion}
      })
      await check(device.udid + ':wda', async() => {
        const apps = JSON.parse(await ios(['--udid=' + device.udid, 'apps'])) as
          Array<{CFBundleIdentifier?: string}>
        if (!Array.isArray(apps) ||
            !apps.some(app => app.CFBundleIdentifier === device.wdaBundleId)) {
          throw new Error('Install the signed WDA runner ' + device.wdaBundleId)
        }
        return device.wdaBundleId
      })
    }
    const passed = checks.every(item => item.passed)
    process.stdout.write(JSON.stringify({passed, checks}, null, 2) + '\n')
    process.exitCode = passed ? 0 : 1
    return
  }
  const build = async() => {
    if ([values['stf-image'], values['ios-image']].some(image => image.includes('@'))) {
      throw new Error('Building requires image tags; use --no-build with prebuilt image digests')
    }
    await run(['build', '--file', 'Dockerfile', '--tag', values['stf-image'], '.'])
    await run(['build', '--file', 'docker/ios/Dockerfile', '--tag', values['ios-image'], '.'])
  }
  if (command === 'build') {
    await build()
    return
  }
  if (command === 'prepare' || command === 'up') {
    if (!config) {
      throw new Error('--config FILE is required; see docker/ios/devices.example.json')
    }
    if (command === 'up') {
      if (process.platform !== 'linux') {
        throw new Error('Run up on the Linux USB host; Docker Desktop USB is not supported here')
      }
      await checkEngine()
      if (!(await probeSocket(values.socket))) {
        throw new Error('Host usbmuxd is unavailable; connect the phone and run doctor first')
      }
      await fs.access('/dev/net/tun')
    }
    await privateDirectory(directory)
    const secret = await secretFile(path.join(directory, 'session-secret'), 0o600)
    for (const device of config.devices) {
      // The parent directory is 0700; bind-mounted token files must be readable
      // by UID 1000 inside the otherwise unprivileged containers.
      await secretFile(path.join(directory, iosDeviceId(device.udid) + '.token'), 0o644)
    }
    const env = {...process.env, STF_SECRET: secret, STF_IMAGE: values['stf-image']
      , STF_PUBLIC_IP: new URL(config.publicOrigin).hostname}
    // `compose config` serializes literal dollars as $$ for another Compose
    // load. Decode before editing, then encode the entire generated document.
    const base = composeDollars(JSON.parse(await capture('docker', [
      'compose', '--file', path.join(repository, 'docker-compose.yaml')
      , 'config', '--format', 'json'
    ], env)), false) as ComposeDocument
    const {document, screenRoutes} = renderIosCompose(base, config, {
      repository, directory, stfImage: values['stf-image'], iosImage: values['ios-image']
    , socketPath: values.socket
    , ...(process.env.SCREEN_GRABBER ? {androidScreenGrabber: process.env.SCREEN_GRABBER} : {})
    })
    const nginx = renderIosNginx(await fs.readFile(
      path.join(repository, 'docker/compose/nginx.conf'), 'utf8'), screenRoutes)
    await fs.writeFile(path.join(directory, 'nginx.conf'), nginx, {mode: 0o600})
    await fs.writeFile(generated, JSON.stringify(composeDollars(document, true), null, 2) + '\n'
      , {mode: 0o600})
    await capture('docker', [...compose, 'config', '--quiet'])
    process.stdout.write('Prepared ' + config.devices.length + ' iPhone(s) in ' + directory + '\n')
    if (command === 'up') {
      if (!values['no-build']) {
        await build()
      }
      // Recreate the entire set: a replaced namespace must never leave siblings
      // attached to the old namespace. Ordinary child restarts keep the anchor.
      await run([...compose, 'up', '--detach', '--wait', '--wait-timeout', '180'
        , '--force-recreate', '--remove-orphans'])
      process.stdout.write('Open ' + config.publicOrigin + '\n')
    }
    return
  }
  await fs.access(generated)
  const argumentsByCommand: Record<string, string[]> = {
    status: ['ps', '--all'], logs: ['logs', '--follow', '--tail', '100'], down: ['down']
  }
  await run([...compose, ...argumentsByCommand[command]!])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write((error as Error).message + '\n')
    process.exitCode = 1
  })
}
