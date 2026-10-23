import {execFile, spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'

export function runCommand(
  binary: string, args: string[], timeout = 15000, signal?: AbortSignal
): Promise<string> {
  return new Promise(function(resolve, reject) {
    execFile(binary, args, {
      timeout, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024, ...(signal ? {signal} : {})
    },
      function(error, stdout, stderr) {
        if (error) {
          reject(new Error(binary + ': ' + (stderr.trim().slice(-2000) || error.message)))
          return
        }
        resolve(stdout)
      })
  })
}

export async function runJson(
  binary: string, args: string[], timeout = 15000, signal?: AbortSignal
): Promise<unknown> {
  const stdout = await runCommand(binary, args, timeout, signal)
  try {
    return JSON.parse(stdout)
  }
  catch {
    throw new Error(binary + ' did not return JSON')
  }
}

export class ManagedProcess {
  failure: Error | null = null
  private child: ChildProcess
  private closed: Promise<void>

  constructor(binary: string, args: string[]) {
    this.child = spawn(binary, args, {stdio: ['ignore', 'ignore', 'pipe']})
    let stderr = ''
    this.child.stderr!.on('data', function(chunk: Buffer) {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    this.closed = new Promise(resolve => {
      this.child.once('error', error => {
        this.failure = error
      })
      this.child.once('close', (code, signal) => {
        this.failure ??= new Error(binary + ' exited (' + (signal || code) + '): ' + stderr.trim())
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      await this.closed
      return
    }
    this.child.kill('SIGTERM')
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000)
    try {
      await this.closed
    }
    finally {
      clearTimeout(timer)
    }
  }
}
