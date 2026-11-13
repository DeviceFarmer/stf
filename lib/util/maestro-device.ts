export interface MaestroBaseline {
  packages: string[]
  settings: Record<string, string>
}

/** Resolves stdout only after confirming command success; rejects timeout or ambiguous outcome. */
export type MaestroExecute = (command: string) => Promise<string>

const DRIVER_PACKAGES = ['dev.mobile.maestro', 'dev.mobile.maestro.test']
const SETTINGS = [
  'system/accelerometer_rotation', 'system/user_rotation'
, 'global/window_animation_scale'
, 'global/transition_animation_scale', 'global/animator_duration_scale'
, 'secure/default_input_method'
]

async function packages(execute: MaestroExecute) {
  const output = await execute('pm list packages')
  return output.split('\n').filter(line => line.startsWith('package:'))
    .map(line => line.slice('package:'.length).trim())
    .filter(name => DRIVER_PACKAGES.includes(name)).sort()
}

async function setting(execute: MaestroExecute, key: string) {
  const [scope, name] = key.split('/')
  return await execute(`settings get ${scope} ${name}`)
}

export async function inspectMaestroDevice(execute: MaestroExecute): Promise<MaestroBaseline> {
  const installedPackages = await packages(execute)
  const settings: Record<string, string> = {}
  for (const key of SETTINGS) {
    settings[key] = await setting(execute, key)
  }
  return {packages: installedPackages, settings}
}

export async function prepareMaestroDevice(execute: MaestroExecute) {
  await execute('input keyevent KEYCODE_WAKEUP')
  // This only dismisses an unsecured keyguard; it never enters or removes a PIN.
  await execute('wm dismiss-keyguard')
}

export async function cleanupMaestroDevice(execute: MaestroExecute, baseline: MaestroBaseline) {
  for (const name of DRIVER_PACKAGES) {
    await execute('am force-stop ' + name)
  }
  const processes = await execute('ps -A')
  const driverProcess = /(?:^|\s)dev\.mobile\.maestro(?:\.test)?(?::[^\s]+)?\s*$/
  if (processes.split('\n').some(line => driverProcess.test(line))) {
    throw new Error('Maestro driver process is still running')
  }
  const instrumentation = await execute('dumpsys activity instrumentation')
  if (/dev\.mobile\.maestro/.test(instrumentation)) {
    throw new Error('Maestro instrumentation is still registered')
  }
  const installed = await packages(execute)
  for (const name of installed.filter(value => !baseline.packages.includes(value))) {
    const output = await execute('pm uninstall ' + name)
    if (output !== 'Success') {
      throw new Error('Maestro driver uninstall was not confirmed')
    }
  }
  if (JSON.stringify(await packages(execute)) !== JSON.stringify([...baseline.packages].sort())) {
    throw new Error('Maestro package restoration was not confirmed')
  }
  for (const key of SETTINGS) {
    const value = baseline.settings[key]
    if (typeof value !== 'string' || value.length > 1024) {
      throw new Error('Invalid Maestro baseline')
    }
    if (await setting(execute, key) === value) {
      continue
    }
    const [scope, name] = key.split('/')
    if (value === 'null') {
      await execute(`settings delete ${scope} ${name}`)
    }
    else {
      // Baselines come from the phone; quoting still prevents shell metacharacters in an IME ID.
      const quoted = "'" + value.replace(/'/g, "'\\''") + "'"
      await execute(`settings put ${scope} ${name} ${quoted}`)
    }
    if (await setting(execute, key) !== value) {
      throw new Error('Maestro setting restoration failed')
    }
  }
}
