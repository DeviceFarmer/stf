import logger from '../../util/logger.js'
import lifecycle from '../../util/lifecycle.js'
import zmqutil from '../../util/zmqutil.js'
import {PrototypeClient} from './client.js'
import {IosBridge, type BridgeOptions} from './bridge.js'
import {createScreenServer} from './screen.js'

export default async function(options: BridgeOptions & {
  prototypeUrl: string, tokenFile: string, apiUrl: string, publicOrigin: string
  screenPort: number, endpoints: {push: string[], sub: string[]}
}) {
  const log = logger.createLogger('ios-provider')
  const client = await PrototypeClient.fromFile(options.prototypeUrl, options.tokenFile)
  const push = zmqutil.socket('push')
  const sub = zmqutil.socket('sub')
  for (const endpoint of options.endpoints.push) {
    push.connect(endpoint)
  }
  for (const endpoint of options.endpoints.sub) {
    sub.connect(endpoint)
  }
  const bridge = new IosBridge(options, client, (channel, data) => push.send([channel, data]),
    () => screen.disconnect(), error => log.warn('iOS operation failed: %s', String(error)))
  const screen = createScreenServer({
    client, apiUrl: options.apiUrl, publicOrigin: options.publicOrigin, serial: options.serial
  , owner: () => bridge.owner
  , onError: error => log.warn('iOS screen failed: %s', String(error))
  })
  sub.subscribe(bridge.channel)
  sub.subscribe(bridge.solo)
  for (const socket of [push, sub]) {
    socket.monitor()
    socket.on('disconnect', () => bridge.absent())
  }
  sub.on('message', (channel: Buffer, data: Buffer) => {
    try {
      bridge.handle(channel.toString(), data)
    }
    catch (error) {
      log.warn('Rejected malformed iOS wire message: %s', String(error))
    }
  })
  screen.server.listen(options.screenPort, '0.0.0.0')
  screen.server.on('error', error => {
    log.fatal('iOS screen server failed: %s', error.message)
    lifecycle.fatal()
  })
  let stopping = false
  let timer: NodeJS.Timeout | undefined
  const poll = async() => {
    await bridge.poll()
    if (!stopping) {
      timer = setTimeout(() => {
        poll()
      }, 2000)
    }
  }
  lifecycle.observe(() => {
    stopping = true
    clearTimeout(timer)
    bridge.absent()
    screen.close()
    sub.unmonitor()
    push.unmonitor()
    sub.close()
    push.close()
  })
  log.info('Starting Linux iOS provider')
  await poll()
}
