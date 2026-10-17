import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {runCommand, runJson} from './process.mts'
import type {IosRuntime} from './runtime.mts'

export interface IpaManifest {
  package: string
  name: string
  version: string
  minimumOSVersion: string
  profileExpiresAt: string
}

export interface InstallJob {
  id: string
  state: 'downloading' | 'validating_app' | 'installing_app' | 'verifying_app' |
    'launching_app' | 'installed' | 'failed' | 'canceled'
  settled: boolean
  progress: number | null
  manifest: IpaManifest | null
  error: string | null
  outcomeUncertain: boolean
  launchError: boolean
}

interface StoredJob extends InstallJob {
  lease: string
  artifact: {id: string, name: string}
  instance: string
  generation: number
  launch: boolean
  updatedAt: number
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export class InstallError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

function valid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuid.test(value)) {
    throw new InstallError('IOS_INSTALL_INVALID_REQUEST')
  }
}

export class Installations {
  private jobs = new Map<string, StoredJob>()
  private active: {
    job: StoredJob, abort: AbortController, done: Promise<void>, expires: number
  } | null = null
  private timer: NodeJS.Timeout
  private stopped = false
  private accepting = false
  readonly options: {storageUrl: string, directory: string, maxBytes: number}
  private runtime: IosRuntime
  private dependencies: {run: typeof runCommand, json: typeof runJson}
  private constructor(
    options: {storageUrl: string, directory: string, maxBytes: number}
  , runtime: IosRuntime
  , dependencies: {run: typeof runCommand, json: typeof runJson}
  ) {
    this.options = options
    this.runtime = runtime
    this.dependencies = dependencies
    const storage = new URL(options.storageUrl)
    if (!['http:', 'https:'].includes(storage.protocol) || storage.username || storage.password ||
        storage.search || storage.hash || storage.pathname !== '/') {
      throw new Error('--storage-url must be a trusted HTTP(S) storage origin')
    }
    this.timer = setInterval(() => {
      const current = this.active
      if (current && (Date.now() > current.expires || !this.current(current.job))) {
        current.abort.abort(new Error('IOS_INSTALL_INTERRUPTED'))
      }
    }, 250)
    this.timer.unref()
  }

  static async create(
    options: {storageUrl: string, directory: string, maxBytes: number}
  , runtime: IosRuntime
  , dependencies = {run: runCommand, json: runJson}
  ) {
    const manager = new Installations(options, runtime, dependencies)
    await fs.mkdir(options.directory, {recursive: true, mode: 0o700})
    for (const file of await fs.readdir(options.directory)) {
      if (/^ipa-[A-Za-z0-9]+$/.test(file) || /^[a-f0-9-]{36}\.json\.tmp$/i.test(file)) {
        await fs.rm(path.join(options.directory, file), {recursive: true, force: true})
      }
      if (!uuid.test(file.replace(/\.json$/, '')) || !file.endsWith('.json')) {
        continue
      }
      let job: StoredJob
      try {
        job = JSON.parse(await fs.readFile(path.join(options.directory, file), 'utf8')) as StoredJob
      }
      catch {
        await fs.unlink(path.join(options.directory, file))
        continue
      }
      if (!job || file !== job.id + '.json' || !uuid.test(job.lease) ||
          !Number.isFinite(job.updatedAt) || Date.now() - job.updatedAt > 86400000) {
        await fs.unlink(path.join(options.directory, file))
        continue
      }
      if (!job.settled) {
        Object.assign(job, {state: 'failed', settled: true, error: 'IOS_INSTALL_INTERRUPTED'
          , outcomeUncertain: true, progress: null})
        await manager.save(job)
      }
      manager.jobs.set(job.id, job)
    }
    return manager
  }

  private current(job: StoredJob) {
    return this.runtime.state === 'ready' && this.runtime.instance === job.instance &&
      this.runtime.generation === job.generation
  }

  private public(job: StoredJob): InstallJob {
    return {id: job.id, state: job.state, settled: job.settled, progress: job.progress
      , manifest: job.manifest, error: job.error, outcomeUncertain: job.outcomeUncertain
      , launchError: job.launchError}
  }

  private save(job: StoredJob) {
    job.updatedAt = Date.now()
    const file = path.join(this.options.directory, job.id + '.json')
    return fs.writeFile(file + '.tmp', JSON.stringify(job), {mode: 0o600})
      .then(() => fs.rename(file + '.tmp', file))
  }

  private job(lease: unknown, id?: unknown) {
    valid(lease)
    if (typeof id !== 'undefined') {
      valid(id)
      const job = this.jobs.get(id)
      if (!job || job.lease !== lease) {
        throw new InstallError('IOS_INSTALL_NOT_FOUND', 404)
      }
      return job
    }
    return [...this.jobs.values()].filter(job => job.lease === lease)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  }

  status(input: {lease?: unknown, id?: unknown}) {
    const job = this.job(input.lease, input.id)
    return job ? this.public(job) : null
  }

  keepalive(input: {lease?: unknown, id?: unknown}) {
    const job = this.job(input.lease, input.id)
    if (job && this.active?.job === job) {
      this.active.expires = Date.now() + 10000
    }
    return job ? this.public(job) : null
  }

  async cancel(input: {lease?: unknown, id?: unknown}) {
    const job = this.job(input.lease, input.id)
    if (job && this.active?.job === job) {
      const active = this.active
      active.abort.abort(new Error('IOS_INSTALL_CANCELED'))
      await active.done
    }
    return job ? this.public(job) : null
  }

  async start(input: {
    id?: unknown, lease?: unknown, artifact?: {id?: unknown, name?: unknown}
    instance?: unknown, generation?: unknown, launch?: unknown
  }) {
    valid(input.id)
    valid(input.lease)
    valid(input.artifact?.id)
    if (typeof input.artifact?.name !== 'string' || !/^[a-f0-9]{32}$/i.test(input.artifact.name) ||
        typeof input.launch !== 'boolean') {
      throw new InstallError('IOS_INSTALL_INVALID_REQUEST')
    }
    const artifact = {id: input.artifact.id, name: input.artifact.name}
    const existing = this.jobs.get(input.id)
    if (existing) {
      if (existing.lease !== input.lease || existing.artifact.id !== artifact.id ||
          existing.artifact.name !== artifact.name || existing.launch !== input.launch) {
        throw new InstallError('IOS_INSTALL_INVALID_REQUEST')
      }
      return this.public(existing)
    }
    if (this.stopped || this.active || this.accepting) {
      throw new InstallError('IOS_INSTALL_BUSY', 409)
    }
    const job: StoredJob = {
      id: input.id, lease: input.lease, artifact, launch: input.launch
    , instance: String(input.instance)
    , generation: Number(input.generation), state: 'downloading', settled: false, progress: 0
    , manifest: null, error: null, outcomeUncertain: false, launchError: false
    , updatedAt: Date.now()
    }
    if (!this.current(job)) {
      throw new InstallError('IOS_INSTALL_INTERRUPTED', 409)
    }
    this.accepting = true
    try {
      for (const old of [...this.jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt)) {
        if (old.settled && (this.jobs.size >= 64 || Date.now() - old.updatedAt > 86400000)) {
          await fs.unlink(path.join(this.options.directory, old.id + '.json'))
          this.jobs.delete(old.id)
        }
      }
      await this.save(job)
      this.jobs.set(job.id, job)
      if (this.stopped || !this.current(job)) {
        Object.assign(job, {state: 'failed', settled: true, error: 'IOS_INSTALL_INTERRUPTED'})
        await this.save(job)
        throw new InstallError('IOS_INSTALL_INTERRUPTED', 409)
      }
      const active = {job, abort: new AbortController(), expires: Date.now() + 10000
        , done: Promise.resolve()}
      this.active = active
      active.done = this.run(job, input.launch, active.abort).catch(error => {
        process.stderr.write('Unable to save iOS installation status: ' + String(error) + '\n')
      }).finally(() => {
        this.active = null
      })
      return this.public(job)
    }
    finally {
      this.accepting = false
    }
  }

  private args(...args: string[]) {
    return ['--udid=' + this.runtime.options.udid
      , '--tunnel-info-port=' + this.runtime.options.tunnelPort, ...args]
  }

  private async run(job: StoredJob, launch: boolean, abort: AbortController) {
    let directory: string | null = null
    let installationStarted = false
    const signal = abort.signal
    try {
      directory = await fs.mkdtemp(path.join(this.options.directory, 'ipa-'))
      const file = path.join(directory, 'app.ipa')
      const response = await fetch(new URL('/s/blob/' + job.artifact.id + '/' + job.artifact.name,
        this.options.storageUrl), {signal: AbortSignal.any([signal, AbortSignal.timeout(120000)])
        , redirect: 'error'})
      if (!response.ok || !response.body) {
        throw new InstallError('IOS_INSTALL_ARTIFACT_MISSING')
      }
      const length = Number(response.headers.get('content-length'))
      if (length > this.options.maxBytes) {
        await response.body.cancel()
        throw new InstallError('IOS_IPA_TOO_LARGE')
      }
      const handle = await fs.open(file, 'wx', 0o600)
      let bytes = 0
      try {
        for await (const chunk of response.body) {
          bytes += chunk.length
          if (bytes > this.options.maxBytes) {
            throw new InstallError('IOS_IPA_TOO_LARGE')
          }
          await handle.writeFile(chunk)
          job.progress = length > 0 ? Math.min(100, Math.floor(bytes / length * 100)) : null
        }
      }
      finally {
        await handle.close()
      }
      signal.throwIfAborted()
      job.state = 'validating_app'
      job.progress = null
      const metadata = await this.dependencies.json('python3', [
        fileURLToPath(new URL('./ipa_metadata.py', import.meta.url)), file
      , this.runtime.options.udid
      , (this.runtime.info as {ProductVersion?: string})?.ProductVersion || '0'
      ], 15000, signal) as {manifest?: IpaManifest, error?: string}
      if (metadata.error || !metadata.manifest) {
        throw new InstallError(metadata.error || 'IOS_IPA_INVALID')
      }
      job.manifest = metadata.manifest
      if (job.manifest.package === this.runtime.options.bundleId) {
        throw new InstallError('IOS_INSTALL_WDA_PROTECTED')
      }
      job.state = 'installing_app'
      await this.save(job)
      signal.throwIfAborted()
      if (!this.current(job)) {
        abort.abort(new Error('IOS_INSTALL_INTERRUPTED'))
        signal.throwIfAborted()
      }
      installationStarted = true
      await this.dependencies.run(this.runtime.options.goIos,
        this.args('install', '--path=' + file), 180000, signal)
      signal.throwIfAborted()
      job.state = 'verifying_app'
      const apps = await this.dependencies.json(this.runtime.options.goIos, this.args('apps'),
        15000, signal) as Array<{
          CFBundleIdentifier?: string, CFBundleShortVersionString?: string, CFBundleVersion?: string
        }>
      if (!Array.isArray(apps) || !apps.some(app =>
        app.CFBundleIdentifier === job.manifest!.package &&
        (app.CFBundleShortVersionString || app.CFBundleVersion || '') === job.manifest!.version)) {
        throw new InstallError('IOS_INSTALL_VERIFY_FAILED')
      }
      if (launch) {
        job.state = 'launching_app'
        try {
          await this.runtime.execute(async(wda, operationSignal) => {
            signal.throwIfAborted()
            if (!this.current(job)) {
              throw new Error('Session changed')
            }
            await wda.call('POST', '/wda/apps/activate', {
              bundleId: job.manifest!.package
            }, operationSignal)
            const active = await wda.call('GET', '/wda/activeAppInfo', undefined, operationSignal)
            if ((active.value as {bundleId?: string})?.bundleId !== job.manifest!.package) {
              throw new Error('Installed app did not stay in the foreground')
            }
          }, false, signal)
        }
        catch {
          signal.throwIfAborted()
          job.launchError = true
        }
      }
      Object.assign(job, {state: 'installed', settled: true, progress: 100})
    }
    catch (error) {
      const canceled = signal.aborted && signal.reason?.message === 'IOS_INSTALL_CANCELED'
      let code = error instanceof InstallError ? error.code : 'IOS_INSTALL_FAILED'
      if (signal.aborted) {
        code = canceled ? 'IOS_INSTALL_CANCELED' : 'IOS_INSTALL_INTERRUPTED'
      }
      else if (/ApplicationVerificationFailed|code.?sign|provision|0xe800801[58]/i
        .test(String(error))) {
        code = 'IOS_IPA_SIGNING'
      }
      else if (/ENOSPC|space|storage.*full/i.test(String(error))) {
        code = 'IOS_INSTALL_NO_SPACE'
      }
      Object.assign(job, {state: canceled ? 'canceled' : 'failed', settled: true, progress: null
        , error: code, outcomeUncertain: installationStarted})
    }
    finally {
      if (directory) {
        await fs.rm(directory, {recursive: true, force: true}).catch(error => {
          process.stderr.write('Unable to remove temporary IPA: ' + String(error) + '\n')
        })
      }
      await this.save(job)
    }
  }

  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    if (this.active) {
      const active = this.active
      active.abort.abort(new Error('IOS_INSTALL_INTERRUPTED'))
      await active.done
    }
  }
}
