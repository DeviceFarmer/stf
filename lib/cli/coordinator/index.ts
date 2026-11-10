import {createRequire} from 'node:module'
import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'
import type {CoordinatorOptions} from '../../units/coordinator/types.js'

const require = createRequire(import.meta.url)

export const command = 'coordinator'
export const describe = 'Queue Appium and Maestro leases and provide their fenced connections.'

export const builder = (yargs: Argv) => yargs
  .strict()
  .env('STF_COORDINATOR')
  .option('host', {
    type: 'string', default: '127.0.0.1', describe: 'Interface to bind the HTTP API to.'
  })
  .option('port', {type: 'number', default: 8080, describe: 'HTTP API port.'})
  .option('public-url', {
    type: 'string', default: 'http://127.0.0.1:8080'
  , describe: 'Base URL reachable by workers, used in lease WebDriver URLs.'
  })
  .option('stf-api-url', {
    type: 'string', demandOption: true, describe: 'STF API base URL, including /api/v1.'
  })
  .option('stf-token-file', {
    type: 'string', demandOption: true
  , describe: 'File containing the STF service-account token.'
  })
  .option('api-token-file', {
    type: 'string', demandOption: true
  , describe: 'File containing the coordinator worker API token.'
  })
  .option('project-tokens-file', {
    type: 'string', describe: 'Optional project token digests and concurrency limits JSON.'
  })
  .option('appium-grid-url', {
    type: 'string', describe: 'Appium Grid base URL. Omit to enable only Maestro leases.'
  })
  .option('state-file', {
    type: 'string', demandOption: true
  , describe: 'Persistent state file; its directory must be writable.'
  })
  .option('adb-pools-file', {
    type: 'string', demandOption: true
  , describe: 'JSON file describing providers, ADB hosts and allowed system ports.'
  })
  .option('lease-ttl-seconds', {
    type: 'number', default: 180
  , describe: 'Lease lifetime after allocation or a successful heartbeat.'
  })
  .option('heartbeat-interval-seconds', {
    type: 'number', default: 30
  , describe: 'Recommended worker heartbeat interval, shorter than the lease TTL.'
  })
  .option('poll-interval-seconds', {
    type: 'number', default: 1, describe: 'Scheduling and expiry check interval.'
  })
  .option('max-duration-seconds', {
    type: 'number', default: 21600
  , describe: 'Maximum duration of a lease, regardless of heartbeat activity.'
  })
  .option('max-parallel', {
    type: 'number', default: 10, describe: 'Maximum number of concurrent leases.'
  })
  .option('upstream-timeout-seconds', {
    type: 'number', default: 30, describe: 'Timeout for an individual upstream HTTP request.'
  })
  .check(argv => {
    if (!Number.isInteger(argv.port) || argv.port < 1 || argv.port > 65535) {
      throw new Error('port must be an integer from 1 to 65535')
    }
    for (const option of [
      'lease-ttl-seconds', 'heartbeat-interval-seconds', 'poll-interval-seconds'
    , 'max-duration-seconds', 'max-parallel', 'upstream-timeout-seconds'
    ] as const) {
      if (!Number.isInteger(argv[option]) || argv[option] <= 0) {
        throw new Error(option + ' must be a positive integer')
      }
    }
    if (argv['heartbeat-interval-seconds'] >= argv['lease-ttl-seconds']) {
      throw new Error('heartbeat-interval-seconds must be shorter than lease-ttl-seconds')
    }
    return true
  })
  .epilog('Run exactly one coordinator for each state file and device pool. ' +
    'Options may also be set with ' +
    'STF_COORDINATOR_ environment variables, for example STF_COORDINATOR_STATE_FILE. ' +
    'Supply credentials through token files; no token values are accepted as options.')

export async function handler(argv: CommandArgv<typeof builder>) {
  const options: CoordinatorOptions = {
    host: argv.host, port: argv.port, publicUrl: argv.publicUrl
  , stfApiUrl: argv.stfApiUrl, stfTokenFile: argv.stfTokenFile, apiTokenFile: argv.apiTokenFile
  , stateFile: argv.stateFile, adbPoolsFile: argv.adbPoolsFile
  , leaseTtlSeconds: argv.leaseTtlSeconds, heartbeatIntervalSeconds: argv.heartbeatIntervalSeconds
  , pollIntervalSeconds: argv.pollIntervalSeconds, maxDurationSeconds: argv.maxDurationSeconds
  , maxParallel: argv.maxParallel, upstreamTimeoutSeconds: argv.upstreamTimeoutSeconds
  , ...(typeof argv.appiumGridUrl === 'undefined' ? {} : {appiumGridUrl: argv.appiumGridUrl})
  , ...(argv.projectTokensFile ? {projectTokensFile: argv.projectTokensFile} : {})
  }
  return require('../../units/coordinator/index.js').default(options)
}
