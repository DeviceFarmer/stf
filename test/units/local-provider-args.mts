import {expect} from 'chai'
import yargs from 'yargs'

import * as local from '../../lib/cli/local/index.js'
import * as provider from '../../lib/cli/provider/index.js'

function parse(module: any, args: (string | number)[]): any {
  let parsed: any
  yargs(args.map(String))
    .exitProcess(false)
    .fail((message: string, error: Error) => {
      throw error || new Error(message)
    })
    .command(module.command, module.describe, module.builder, (argv: any) => {
      parsed = argv
    })
    .parseSync()
  return parsed
}

function providerSerials(localArgs: string[]): (string | number)[] {
  const args = local.providerArgs(parse(local, ['local'].concat(localArgs)))
  return parse(provider, args).serial
}

describe('stf local provider args', function() {
  it('should pass the serial filter through with default options', function() {
    expect(providerSerials(['emulator-5554'])).to.deep.equal(['emulator-5554'])
  })

  it('should keep the serial filter when cleanup folders are given', function() {
    const args = ['emulator-5554', 'emulator-5556', '--cleanup-folder', '/data/local/tmp']
    expect(providerSerials(args)).to.deep.equal(['emulator-5554', 'emulator-5556'])
  })

  it('should handle every device when no serial is given', function() {
    expect(providerSerials(['--no-screen-reset'])).to.deep.equal([])
  })
})
