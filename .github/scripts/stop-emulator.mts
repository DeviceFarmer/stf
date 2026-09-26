import childProcess from 'child_process'

function emulatorPids(port: string) {
  return childProcess.execFileSync('ps', ['-eo', 'pid=,stat=,args='], {
    encoding: 'utf8'
  }).trim().split('\n').filter(function(line) {
    var fields = line.trim().split(/\s+/)
    var portIndex = fields.indexOf('-port', 3)
    return fields[1]!.charAt(0) !== 'Z' &&
      /(^|\/)qemu-system-[^/]+$/.test(fields[2]!) &&
      portIndex !== -1 && fields[portIndex + 1] === port
  }).map(function(line) {
    return Number(line.trim().split(/\s+/)[0])
  })
}

function waitForExit(port: string, seconds: number) {
  for (var waited = 0; waited < seconds; waited++) {
    if (!emulatorPids(port).length) {
      return true
    }
    childProcess.execFileSync('sleep', ['1'])
  }
  return !emulatorPids(port).length
}

function signalEmulator(port: string, signal: NodeJS.Signals) {
  emulatorPids(port).forEach(function(pid) {
    try {
      process.kill(pid, signal)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error
      }
    }
  })
}

function stopEmulator(port: string) {
  if (!/^\d+$/.test(port)) {
    throw new Error('Invalid emulator port: ' + port)
  }

  process.stdout.write('Stopping emulator-' + port + '\n')
  childProcess.spawnSync('adb', ['-s', 'emulator-' + port, 'emu', 'kill'], {
    stdio: 'inherit'
  , timeout: 10000
  , killSignal: 'SIGKILL'
  })

  if (waitForExit(port, 10)) {
    return
  }

  process.stdout.write('::warning::Emulator is still running; sending SIGTERM\n')
  signalEmulator(port, 'SIGTERM')
  if (waitForExit(port, 5)) {
    return
  }

  process.stdout.write('::warning::Emulator ignored SIGTERM; sending SIGKILL\n')
  signalEmulator(port, 'SIGKILL')
  if (!waitForExit(port, 5)) {
    throw new Error('Emulator-' + port + ' is still running after SIGKILL')
  }
}

if (import.meta.main) {
  stopEmulator(process.env.EMULATOR_PORT || '5554')
}

export default stopEmulator
