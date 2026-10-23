import {execFile} from 'node:child_process'

// go-ios v1.3.2 logs power failures but may still exit zero. Require its
// explicit diagnostics acknowledgement rather than treating exit zero as success.
export function runPowerCommand(
  binary: string, args: string[], signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 262144, signal},
      (error, _stdout, stderr) => {
        const messages = stderr.trim().split('\n').flatMap(line => {
          try {
            return [JSON.parse(line) as {level?: string, msg?: string}]
          }
          catch {
            return []
          }
        })
        const failed = messages.some(message => message.level?.toUpperCase() === 'ERROR')
        const acknowledged = messages.some(message =>
          message.msg === 'ok' && message.level?.toUpperCase() === 'INFO')
        if (error || failed || !acknowledged) {
          reject(new Error('IOS_POWER_FAILED'))
          return
        }
        resolve()
      })
  })
}
