import type {Argv} from 'yargs'
import type {CommandArgv} from '../../types/cli.js'
import start from '../../units/ios-provider/index.js'

export const command = 'ios-provider'
export const describe = 'Connect a Linux iOS prototype to STF.'
export const builder = (yargs: Argv) => yargs.strict().env('STF_IOS_PROVIDER')
  .option('serial', {type: 'string', demandOption: true})
  .option('token-file', {type: 'string', demandOption: true})
  .option('prototype-url', {type: 'string', default: 'http://127.0.0.1:7400'})
  .option('api-url', {type: 'string', demandOption: true})
  .option('public-origin', {type: 'string', demandOption: true})
  .option('storage-url', {type: 'string', demandOption: true})
  .option('screen-url', {type: 'string', demandOption: true})
  .option('screen-port', {type: 'number', default: 17440})
  .option('group-timeout', {type: 'number', default: 900})
  .option('name', {type: 'string', default: 'Linux iOS'})
  .option('market-name', {type: 'string', default: ''})
  .option('connect-push', {type: 'array', demandOption: true})
  .option('connect-sub', {type: 'array', demandOption: true})

export async function handler(argv: CommandArgv<typeof builder>) {
  await start({
    serial: argv.serial, tokenFile: argv.tokenFile, prototypeUrl: argv.prototypeUrl
  , apiUrl: argv.apiUrl, publicOrigin: argv.publicOrigin, storageUrl: argv.storageUrl
  , screenUrl: argv.screenUrl, screenPort: argv.screenPort, groupTimeout: argv.groupTimeout
  , name: argv.name, marketName: argv.marketName
  , endpoints: {push: argv.connectPush.map(String), sub: argv.connectSub.map(String)}
  })
}
