import assert from 'node:assert/strict'
import {describe, it} from 'node:test'
import {runPowerCommand} from '../power.mts'

describe('iOS power acknowledgement', () => {
  it('checks acknowledgement even when go-ios exits zero', async() => {
    const run = (messages: unknown[], exit = 0) => {
      const lines = messages.map(m => JSON.stringify(m)).join('\n')
      const code = 'process.stderr.write(' + JSON.stringify(lines) + ');process.exit(' + exit + ')'
      return runPowerCommand(process.execPath, ['-e', code])
    }
    await run([{level: 'WARN', msg: 'agent status'}, {level: 'INFO', msg: 'ok'}])
    await assert.rejects(run([{level: 'ERROR', msg: 'reboot failed'}]), /IOS_POWER_FAILED/)
    await assert.rejects(run([
      {level: 'INFO', msg: 'ok'}, {level: 'ERROR', msg: 'failed'}
    ]), /IOS_POWER_FAILED/)
    await assert.rejects(run([]), /IOS_POWER_FAILED/)
    await assert.rejects(run([{level: 'INFO', msg: 'ok'}], 1), /IOS_POWER_FAILED/)
    await assert.rejects(runPowerCommand('/does-not-exist', []), /IOS_POWER_FAILED/)
  })
})
