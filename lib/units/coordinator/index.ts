import http from 'node:http'
import {once} from 'node:events'
import lifecycle from '../../util/lifecycle.js'
import logger from '../../util/logger.js'
import {HttpFarmBackend} from './backend.js'
import {CoordinatorError, secret, validateOptions} from './config.js'
import {Coordinator} from './engine.js'
import {createCoordinatorApp} from './http.js'
import {CoordinatorAccess} from './access.js'
import {FileStateStore} from './state.js'
import type {CoordinatorOptions} from './types.js'

export default async function startCoordinator(options: CoordinatorOptions) {
  const pools = await validateOptions(options)
  const [stfToken, apiToken] = await Promise.all([
    secret(options.stfTokenFile), secret(options.apiTokenFile)
  ])
  const log = logger.createLogger('coordinator')
  const access = await CoordinatorAccess.load(apiToken, options.projectTokensFile)
  const engine = new Coordinator(options, pools,
    new HttpFarmBackend(options.stfApiUrl, options.appiumGridUrl, stfToken,
      options.upstreamTimeoutSeconds * 1000), new FileStateStore(options.stateFile))
  const server = http.createServer(createCoordinatorApp(engine, access))
  server.requestTimeout = (options.upstreamTimeoutSeconds + 10) * 1000
  server.listen(options.port, options.host)
  await once(server, 'listening')
  log.info('Coordinator HTTP endpoint started; recovering persistent leases')
  let timer: ReturnType<typeof setInterval> | undefined
  lifecycle.shutdownTimeout = Math.max(lifecycle.shutdownTimeout, 110000)
  lifecycle.observe(async() => {
    if (timer) {
      clearInterval(timer)
    }
    await engine.stop()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  try {
    await engine.start()
  }
  catch (error) {
    server.closeAllConnections()
    server.close()
    if (error instanceof CoordinatorError && error.code === 'unsupported_state_runner') {
      throw error
    }
    throw new Error('Coordinator recovery failed; persistent state was preserved')
  }
  timer = setInterval(() => {
    engine.tick().catch(() => log.error('Coordinator scheduling failed; inspect health status'))
  }, options.pollIntervalSeconds * 1000)
  log.info('Coordinator is ready')
  return {engine, server}
}
