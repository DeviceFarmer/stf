import path from 'node:path'
import {iosDeviceId, type IosConfig} from '../../lib/util/ios-config.ts'

export interface ComposeOptions {
  repository: string
  directory: string
  stfImage: string
  iosImage: string
  socketPath: string
  androidScreenGrabber?: string
}

interface Service {
  [key: string]: any
}

export interface ComposeDocument {
  services: Record<string, Service>
  volumes?: Record<string, unknown>
  [key: string]: any
}

const supervisor = ['node', 'tools/ios-prototype/container.mts']
const user = {user: '1000:1000', cap_drop: ['ALL']
  , security_opt: ['no-new-privileges:true']}
const ready = {condition: 'service_healthy'}

export function renderIosCompose(
  base: ComposeDocument, config: IosConfig, options: ComposeOptions
) {
  const document: ComposeDocument = structuredClone(base)
  const services = document.services
  document.volumes ??= {}
  delete document.name
  // Canonical Compose output contains names derived from its original project.
  // Let the caller's project namespace its own volumes and networks instead.
  for (const volume of Object.values(document.volumes) as Service[]) {
    if (!volume.external) {
      delete volume.name
    }
  }
  for (const network of Object.values(document.networks || {}) as Service[]) {
    if (!network.external) {
      delete network.name
    }
  }
  if (!config.android) {
    delete services.adb
    delete services.provider
  }
  else if (options.androidScreenGrabber) {
    if (!['auto', 'minicap-bin', 'minicap-apk'].includes(options.androidScreenGrabber)) {
      throw new Error('SCREEN_GRABBER must be auto, minicap-bin or minicap-apk')
    }
    services.provider!.environment ??= {}
    services.provider!.environment.SCREEN_GRABBER = options.androidScreenGrabber
  }
  for (const service of Object.values(services)) {
    if (service.image === options.stfImage) {
      service.pull_policy = 'never'
    }
  }
  services.migrate!.build = {context: options.repository, dockerfile: 'Dockerfile'}
  services.proxy!.volumes = [{type: 'bind', source: path.join(options.directory, 'nginx.conf')
    , target: '/etc/nginx/nginx.conf', read_only: true, bind: {create_host_path: false}}]
  const origin = new URL(config.publicOrigin)
  if (origin.protocol !== 'http:') {
    throw new Error('The local Compose quick start requires an http:// publicOrigin')
  }
  const port = Number(origin.port || 80)
  services.proxy!.ports = [{target: 7100, published: String(port), protocol: 'tcp'}]
  services.auth!.command = ['stf', 'auth-mock', '--app-url', config.publicOrigin + '/']
  services.app!.command = ['stf', 'app', '--auth-url', config.publicOrigin + '/auth/mock/'
    , '--websocket-url', config.publicOrigin + '/']
  const screenRoutes: Array<{path: string, target: string}> = []
  for (const [index, device] of config.devices.entries()) {
    const id = iosDeviceId(device.udid)
    const namespace = id + '-network'
    const tunnel = id + '-tunnel'
    const runtime = id + '-runtime'
    const init = id + '-init'
    const state = id + '-state'
    const token = {type: 'bind', source: path.join(options.directory, id + '.token')
      , target: '/token/token', read_only: true, bind: {create_host_path: false}}
    const usb = {type: 'bind', source: options.socketPath, target: '/run/usbmuxd'
      , read_only: true, bind: {create_host_path: false}}
    const common: Service = {image: options.iosImage, pull_policy: 'never'
      , restart: 'unless-stopped', stop_grace_period: '15s'}
    const network = {network_mode: 'service:' + namespace}
    document.volumes[state] = {}
    services[namespace] = {...common, ...user
      , command: [...supervisor, 'namespace'], read_only: true}
    if (index === 0) {
      services[namespace]!.build = {
        context: options.repository, dockerfile: 'docker/ios/Dockerfile'}
    }
    services[init] = {...common, restart: 'no', user: '0:0', cap_drop: ['ALL']
      , cap_add: ['CHOWN', 'FOWNER'], network_mode: 'none', read_only: true
      , command: [...supervisor, 'init'], volumes: [state + ':/state']}
    const dependencies = {[namespace]: {condition: 'service_started'}
      , [init]: {condition: 'service_completed_successfully'}}
    services[tunnel] = {...common, ...network, user: '0:0', privileged: true
      , command: [...supervisor, 'supervise', 'ios', '--udid=' + device.udid
        , '--tunnel-info-port=28100', 'tunnel', 'start'
        , '--pair-record-path=/state/remotepairing']
      , depends_on: dependencies
      , volumes: [usb, state + ':/state', '/dev/net/tun:/dev/net/tun']}
    services[runtime] = {...common, ...user, ...network
      , command: [...supervisor, 'supervise', 'node', 'tools/ios-prototype/main.mts'
        , '--udid=' + device.udid, '--wda-bundle-id=' + device.wdaBundleId
        , '--image-mounter=pymobiledevice3', '--token-file=/token/token'
        , '--storage-url=http://storage:7100/']
      , depends_on: {...dependencies, [tunnel]: {condition: 'service_started'}, storage: ready}
      , volumes: [usb, token, state + ':/home/node:rw']
      , environment: {HOME: '/home/node/home'}
      , healthcheck: {
        test: ['CMD', 'node', '-e', 'require("net").connect(7400,"127.0.0.1")' +
          '.on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))']
        , interval: '5s', timeout: '3s', retries: 36
      }}
    services[id] = {image: options.stfImage, pull_policy: 'never', ...user, ...network
      , init: true, restart: 'unless-stopped', stop_grace_period: '15s'
      , command: ['stf', 'ios-provider', '--serial=' + device.udid
        , '--token-file=/token/token', '--prototype-url=http://127.0.0.1:7400'
        , '--api-url=http://api:7100', '--public-origin=' + config.publicOrigin
        , '--storage-url=http://storage:7100/'
        , '--screen-url=' + config.publicOrigin.replace('http:', 'ws:') + '/ios/' + id + '/screen'
        , '--connect-push=tcp://triproxy-dev:7113', '--connect-sub=tcp://triproxy-dev:7111'
        , '--name=Local iOS', '--market-name=' + (device.name || '')]
      , depends_on: {...dependencies, [runtime]: ready, api: ready, 'triproxy-dev': ready
        , processor: {condition: 'service_started'}
        , 'groups-engine': {condition: 'service_started'}}
      , volumes: [token]
      , healthcheck: {
        test: ['CMD', 'node', '-e', 'require("net").connect(17440,"127.0.0.1")' +
          '.on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))']
        , interval: '5s', timeout: '3s', retries: 36
      }}
    screenRoutes.push({path: '/ios/' + id + '/screen', target: namespace + ':17440'})
  }
  return {document, screenRoutes}
}

export function renderIosNginx(base: string, routes: Array<{path: string, target: string}>) {
  const marker = '    location / {'
  if (!base.includes(marker)) {
    throw new Error('The base Nginx configuration has no default location')
  }
  const locations = routes.map(route => `    location = ${route.path} {
      set $ios_backend ${route.target};
      proxy_pass http://$ios_backend/;
      proxy_http_version 1.1;
      proxy_set_header Host $http_host;
      proxy_set_header Origin $http_origin;
      proxy_set_header Cookie $http_cookie;
      proxy_set_header Authorization $http_authorization;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_read_timeout 3600s;
    }
`).join('\n')
  return base.replace(marker, locations + '\n' + marker)
}
