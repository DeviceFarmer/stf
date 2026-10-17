import fs from 'node:fs/promises'
import {parseArgs} from 'node:util'
import os from 'node:os'
import path from 'node:path'

import {IosRuntime} from './runtime.mts'
import {createServer} from './server.mts'
import {diagnose} from './doctor.mts'
import {Installations} from './installations.mts'
import type {ImageMounter} from './tunnel.mts'

const {values} = parseArgs({options: {
  udid: {type: 'string'}
, 'wda-bundle-id': {type: 'string'}
, 'xctest-config': {type: 'string', default: 'WebDriverAgentRunner.xctest'}
, 'go-ios': {type: 'string', default: 'ios'}
, iproxy: {type: 'string', default: 'iproxy'}
, 'image-mounter': {type: 'string', default: 'go-ios'}
, pymobiledevice3: {type: 'string', default: 'pymobiledevice3'}
, port: {type: 'string', default: '7400'}
, 'wda-port': {type: 'string', default: '18100'}
, 'mjpeg-port': {type: 'string', default: '19100'}
, 'tunnel-port': {type: 'string', default: '28100'}
, 'token-file': {type: 'string'}
, 'storage-url': {type: 'string'}
, 'install-dir': {type: 'string', default: path.join(os.homedir(), '.stf-ios-installations')}
, 'state-dir': {type: 'string', default: path.join(os.homedir(), '.stf-ios')}
, help: {type: 'boolean', short: 'h'}
, doctor: {type: 'boolean'}
}})

const requestedMounter = values['image-mounter']
if (requestedMounter !== 'go-ios' && requestedMounter !== 'pymobiledevice3') {
  throw new Error('--image-mounter must be go-ios or pymobiledevice3')
}
const imageMounter: ImageMounter = requestedMounter

if (values.help) {
  process.stdout.write('Usage: npm run ios:prototype -- --udid UDID --wda-bundle-id BUNDLE_ID ' +
    '--token-file /path/to/token\n' +
    'Options: --port 7400 --wda-port 18100 --mjpeg-port 19100 --tunnel-port 28100\n' +
    '         --go-ios ios --iproxy iproxy --xctest-config WebDriverAgentRunner.xctest\n' +
    '         --image-mounter go-ios|pymobiledevice3 --pymobiledevice3 /path/to/pymobiledevice3\n' +
    '         --storage-url http://storage:3000 --install-dir /private/installations\n' +
    'Use pymobiledevice3 for iOS 27 developer images (requires a kernel go-ios tunnel).\n' +
    'Check the Linux host without starting WDA: --doctor [--udid UDID]\n' +
    'Requires a signed, installed WDA and a running go-ios tunnel. Listens on 127.0.0.1.\n')
}
else if (values.doctor) {
  const report = await diagnose({
    goIos: values['go-ios'], iproxy: values.iproxy, tunnelPort: Number(values['tunnel-port'])
  , imageMounter, pymobiledevice3: values.pymobiledevice3
  , ...(values.udid ? {udid: values.udid} : {})
  })
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exitCode = report.passed ? 0 : 1
}

async function main(): Promise<void> {
  if (!values.udid || !/^[A-Za-z0-9-]{8,80}$/.test(values.udid)) {
    throw new Error('--udid must explicitly select an iPhone')
  }
  if (!values['wda-bundle-id'] || !/^[\w.-]+$/.test(values['wda-bundle-id'])) {
    throw new Error('--wda-bundle-id must match the installed WDA runner identifier')
  }
  const token = values['token-file'] ?
    (await fs.readFile(values['token-file'], 'utf8')).trim() : process.env.STF_IOS_PROTOTYPE_TOKEN
  if (!token || token.length < 32) {
    throw new Error('Provide --token-file or STF_IOS_PROTOTYPE_TOKEN with at least 32 characters')
  }
  const port = (value: string) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      throw new Error('Ports must be integers between 1024 and 65535')
    }
    return parsed
  }
  const ports = [
    values.port, values['wda-port'], values['mjpeg-port'], values['tunnel-port']
  ].map(port)
  if (new Set(ports).size !== ports.length) {
    throw new Error('API, WDA, MJPEG and tunnel ports must be different')
  }
  const runtime = new IosRuntime({
    udid: values.udid, bundleId: values['wda-bundle-id'], xctest: values['xctest-config']
  , goIos: values['go-ios'], iproxy: values.iproxy
  , imageMounter, pymobiledevice3: values.pymobiledevice3
  , wdaPort: ports[1]!, mjpegPort: ports[2]!, tunnelPort: ports[3]!
  , retryMs: 5000, startupMs: 60000
  , stateDirectory: values['state-dir']
  })
  const installations = values['storage-url'] ? await Installations.create({
    storageUrl: values['storage-url'], directory: values['install-dir'], maxBytes: 1024 ** 3
  }, runtime) : undefined
  const server = createServer(runtime, token, installations)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(ports[0], '127.0.0.1', resolve)
  })
  runtime.start()
  process.stderr.write('iOS prototype listening at http://127.0.0.1:' + ports[0] + '\n')
  let stopping = false
  const stop = async() => {
    if (stopping) {
      return
    }
    stopping = true
    server.close()
    server.closeAllConnections()
    await installations?.stop()
    await runtime.stop()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

if (!values.help && !values.doctor) {
  await main()
}
