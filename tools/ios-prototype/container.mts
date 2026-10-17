import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import {pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'

export function probeSocket(socketPath: string, timeout = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect(socketPath)
    const finish = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeout, () => finish(false))
    socket.once('error', () => finish(false))
    socket.once('connect', () => finish(true))
  })
}

// Docker healthchecks alone do not restart an unhealthy container. Exit the
// wrapper on a stale socket so restart remounts the host's replacement inode.
export async function supervise(command: string[], options: {
  socketPath?: string
  intervalMs?: number
  failures?: number
  parentPipe?: boolean
  signal?: AbortSignal
} = {}): Promise<number> {
  if (!command[0]) {
    throw new Error('A child command is required')
  }
  const child = spawn(command[0], command.slice(1), {stdio: ['ignore', 'inherit', 'inherit']})
  let stopping = false
  let failed = false
  let misses = 0
  let checking = false
  let killTimer: NodeJS.Timeout | undefined
  const stop = () => {
    if (stopping) {
      return
    }
    stopping = true
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), 8000)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  options.signal?.addEventListener('abort', stop, {once: true})
  if (options.signal?.aborted) {
    stop()
  }
  if (options.parentPipe) {
    process.stdin.resume()
    process.stdin.once('end', stop)
  }
  const timer = options.socketPath ? setInterval(async() => {
    if (checking || stopping) {
      return
    }
    checking = true
    const ok = await probeSocket(options.socketPath!)
    checking = false
    misses = ok ? 0 : misses + 1
    if (misses >= (options.failures ?? 2)) {
      failed = true
      process.stderr.write('usbmuxd is unavailable; restarting to reconnect its socket\n')
      stop()
    }
  }, options.intervalMs ?? 5000) : undefined
  try {
    return await new Promise(resolve => {
      child.once('error', error => {
        failed = true
        process.stderr.write(error.message + '\n')
      })
      child.once('close', (code, signal) => {
        if (failed) {
          resolve(1)
        }
        else {
          resolve(code ?? Number(!stopping && !!signal))
        }
      })
    })
  }
  finally {
    clearInterval(timer)
    clearTimeout(killTimer)
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    options.signal?.removeEventListener('abort', stop)
    process.stdin.removeListener('end', stop)
    if (options.parentPipe) {
      process.stdin.pause()
    }
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'namespace') {
    // Keep the network namespace alive across tunnel/runtime/provider restarts.
    // Recreating this container requires recreating its dependents as well.
    const timer = setInterval(() => {}, 60000)
    const stop = () => clearInterval(timer)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
  else if (mode === 'init') {
    // Another container may initialize the empty volume from /home/node first.
    // Own its root before creating children; CHOWN/FOWNER suffice without DAC_OVERRIDE.
    await fs.chown('/state', 0, 0)
    await fs.chmod('/state', 0o755)
    for (const directory of ['/state/home', '/state/remotepairing']) {
      await fs.mkdir(directory, {recursive: true, mode: 0o700})
    }
    await fs.chown('/state/home', 1000, 1000)
    await fs.chmod('/state/home', 0o700)
    await fs.chmod('/state/remotepairing', 0o700)
  }
  else if (mode === 'native-tunnel') {
    const abort = new AbortController()
    const stop = () => abort.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    process.stdin.once('end', stop)
    process.stdin.resume()
    try {
      while (!abort.signal.aborted) {
        await supervise(args, {socketPath: '/run/usbmuxd', signal: abort.signal})
        if (!abort.signal.aborted) {
          await delay(5000, undefined, {signal: abort.signal}).catch(() => {})
        }
      }
    }
    finally {
      process.stdin.pause()
      process.stdin.removeListener('end', stop)
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
  }
  else if (mode === 'supervise' || mode === 'parent') {
    process.exitCode = await supervise(args, {
      socketPath: process.env.STF_IOS_USBMUXD_SOCKET || '/run/usbmuxd'
    , parentPipe: mode === 'parent'
    })
  }
  else {
    throw new Error('Use namespace, init, supervise COMMAND..., or parent COMMAND...')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write((error as Error).message + '\n')
    process.exitCode = 1
  })
}
