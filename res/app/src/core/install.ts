import {api} from './api'
import type {Control} from './control'
import {createDeviceStore} from './device-store'
import {gettext, translate} from './i18n'
import {storeFiles, storeUrl} from './storage'

export interface ManifestIntentData {
  scheme?: string
  host?: string
  port?: string
  path?: string
  pathPrefix?: string
  pathPattern?: string
  mimeType?: string
}

export interface ManifestIntentFilter {
  actions?: Array<{name?: string}>
  categories?: Array<{name?: string}>
  data?: ManifestIntentData[]
}

export interface ManifestActivity {
  name?: string
  intentFilters?: ManifestIntentFilter[]
}

export interface Manifest {
  package?: string
  application?: {activities?: ManifestActivity[] | Record<string, never>}
  [key: string]: unknown
}

export interface Installation {
  id: number
  progress: number
  state: string
  settled: boolean
  success: boolean
  error: string | null
  manifest: Manifest | null
  jobId?: string
  indeterminate?: boolean
  outcomeUncertain?: boolean
  launchError?: boolean
}

interface StoredResource {
  href: string
}

export type InstallationListener = (installation: Installation) => void

export const installationStore = createDeviceStore<Installation | null>(null)

const installStateLabels: Record<string, string> = {
  downloading: gettext('Downloading...')
  , uploading: gettext('Uploading...')
  , processing: gettext('Processing...')
  , pushing_app: gettext('Pushing app...')
  , installing_app: gettext('Installing app...')
  , launching_app: gettext('Launching app...')
  , validating_app: gettext('Checking IPA...')
  , verifying_app: gettext('Verifying installation...')
}

let installationCounter = 0

function startInstallation(serial: string, state: string, onChange?: InstallationListener) {
  installationCounter += 1
  let installation: Installation = {
    id: installationCounter
    , progress: 0
    , state
    , settled: false
    , success: false
    , error: null
    , manifest: null
  }

  installationStore.set(serial, installation)
  onChange?.(installation)

  function patch(delta: Partial<Installation>) {
    installation = {...installation, ...delta}
    installationStore.update(serial, (current) => (current?.id === installation.id ? installation : current))
    onChange?.(installation)
  }

  return {
    patch
    , current: () => installation
    , update: (progress: number, nextState: string) => patch({progress: Math.floor(progress), state: nextState})
    , okay: (nextState: string) => patch({settled: true, progress: 100, success: true, state: nextState})
    , fail: (error: string) => patch({settled: true, progress: 100, success: false, error})
  }
}

type Tracker = ReturnType<typeof startInstallation>

interface IosJob {
  id: string
  state: string
  settled: boolean
  progress: number | null
  manifest: Manifest | null
  error: string | null
  outcomeUncertain: boolean
  launchError: boolean
}

const iosWatching = new Map<string, Promise<Installation>>()

function applyIosJob(tracker: Tracker, job: IosJob) {
  tracker.patch({jobId: job.id, state: job.state, settled: job.settled
    , progress: job.progress ?? 0, indeterminate: job.progress === null
    , manifest: job.manifest, error: job.error, success: job.state === 'installed'
    , outcomeUncertain: job.outcomeUncertain, launchError: job.launchError})
}

function watchIosJob(control: Control, tracker: Tracker, initial: IosJob): Promise<Installation> {
  const serial = control.target.serial
  const running = iosWatching.get(serial)
  if (running) {
    return running
  }
  applyIosJob(tracker, initial)
  const watch = (async() => {
    let failures = 0
    const deadline = Date.now() + 420000
    while (!tracker.current().settled) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      try {
        const {body} = await control.iosInstallStatus(initial.id)
        if (!body) {
          throw new Error('IOS_INSTALL_NOT_FOUND')
        }
        applyIosJob(tracker, body as IosJob)
        failures = 0
      }
      catch (error) {
        if (++failures >= 3 || Date.now() > deadline) {
          tracker.patch({settled: true, success: false, indeterminate: false
            , error: failureCode(error), outcomeUncertain: true})
        }
      }
      if (!tracker.current().settled && Date.now() > deadline) {
        tracker.patch({settled: true, success: false, error: 'IOS_INSTALL_STATUS_UNAVAILABLE', outcomeUncertain: true})
      }
    }
    return tracker.current()
  })().finally(() => iosWatching.delete(serial))
  iosWatching.set(serial, watch)
  return watch
}

export async function restoreIosInstallation(control: Control): Promise<void> {
  const serial = control.target.serial
  if (iosWatching.has(serial) || (installationStore.get(serial) && !installationStore.get(serial)?.settled)) {
    return
  }
  const {body} = await control.iosInstallStatus()
  if (body) {
    const job = body as IosJob
    await watchIosJob(control, startInstallation(serial, job.state), job)
  }
}

async function fetchManifest(href: string): Promise<Manifest> {
  const response = await api.get<{success: boolean, manifest?: Manifest}>(`${href}/manifest`)
  if (!response.success || !response.manifest) {
    throw new Error('Unable to retrieve manifest')
  }
  return response.manifest
}

async function installStored(control: Control, installation: Tracker, href: string, manifest: Manifest) {
  installation.patch({manifest})
  await control.install({href, manifest, launch: true})
    .progressed((result) => installation.update(50 + result.progress / 2, result.lastData))
}

function failureCode(error: any): string {
  return String(error?.code || error?.message)
}

export async function installUrl(control: Control, url: string): Promise<void> {
  const installation = startInstallation(control.target.serial, 'downloading')
  try {
    const response = await storeUrl<{resource: StoredResource}>('apk', url)
    installation.update(100 / 2, 'processing')
    const href = response.resource.href
    await installStored(control, installation, href, await fetchManifest(href))
    installation.okay('installed')
  }
  catch (error) {
    installation.fail(failureCode(error))
  }
}

export async function installFile(
  control: Control
, files: File[]
, onChange?: InstallationListener
): Promise<Installation> {
  const existing = installationStore.get(control.target.serial)
  if (existing && !existing.settled) {
    return {...existing, settled: true, success: false, error: 'IOS_INSTALL_BUSY'}
  }
  const installation = startInstallation(control.target.serial, 'uploading', onChange)
  const ios = control.target.platform === 'iOS'
  try {
    if (ios && (files.length !== 1 || !/\.ipa$/i.test(files[0]!.name))) {
      throw new Error('IOS_IPA_INVALID')
    }
    if (ios && files[0]!.size > 1024 ** 3) {
      throw new Error('IOS_IPA_TOO_LARGE')
    }
    const response = await storeFiles<{resources: {file: StoredResource}}>(ios ? 'blob' : 'apk', files, {
      filter: (file) => (ios ? /\.(ipa)$/i : /\.(apk|aab)$/i).test(file.name)
      , onProgress: (progress) => installation.update(progress.loaded / progress.total * (ios ? 100 : 50), 'uploading')
    })
    installation.update(100 / 2, 'processing')
    const href = response.resources.file.href
    if (ios) {
      const requestId = crypto.randomUUID()
      installation.patch({jobId: requestId, indeterminate: true})
      let job: IosJob
      try {
        job = (await control.install({href, manifest: {}, launch: true, requestId})).body as IosJob
      }
      catch (error) {
        // A lost acknowledgement must not submit the same installation twice.
        const status = await control.iosInstallStatus(requestId).catch(() => null)
        if (!status?.body) {
          installation.patch({outcomeUncertain: true})
          throw error
        }
        job = status.body as IosJob
      }
      return await watchIosJob(control, installation, job)
    }
    const manifest = await fetchManifest(href)
    await installStored(control, installation, href, manifest)
    installation.okay('installed')
  }
  catch (error) {
    installation.fail(failureCode(error))
  }
  return installation.current()
}

export function clearInstallation(serial: string) {
  installationStore.set(serial, null)
}

const installErrors: Record<string, string> = {
  IOS_IPA_INVALID: gettext('Select a valid IPA for a physical iPhone.')
  , IOS_IPA_TOO_LARGE: gettext('The IPA exceeds the 1 GiB limit.')
  , IOS_IPA_PLATFORM: gettext('This app is not compatible with a physical iPhone.')
  , IOS_IPA_OS_VERSION: gettext('This app requires a newer iOS version.')
  , IOS_IPA_SIGNING: gettext('The IPA signature or provisioning profile is invalid. Upload a signed development, ad hoc, or enterprise IPA.')
  , IOS_IPA_PROFILE_EXPIRED: gettext('The provisioning profile has expired. Sign the IPA again.')
  , IOS_IPA_DEVICE_NOT_PROVISIONED: gettext('This iPhone is not included in the provisioning profile.')
  , IOS_INSTALL_WDA_PROTECTED: gettext('Replacing WebDriverAgent from this panel is not allowed.')
  , IOS_INSTALL_BUSY: gettext('Another installation is in progress. Wait for it to finish.')
  , IOS_INSTALL_INVALID_REQUEST: gettext('The installation request is invalid.')
  , IOS_INSTALL_ARTIFACT_MISSING: gettext('The uploaded file is no longer available. Upload it again.')
  , IOS_INSTALL_NOT_FOUND: gettext('No installation was found in the current device session.')
  , IOS_INSTALL_STATUS_UNAVAILABLE: gettext('Installation status is unavailable. Check the status again before retrying.')
  , IOS_INSTALL_INTERRUPTED: gettext('Installation was interrupted by a device or session disconnect.')
  , IOS_INSTALL_CANCELED: gettext('Installation canceled by user.')
  , IOS_INSTALL_NO_SPACE: gettext('There is not enough free space on the iPhone.')
  , IOS_INSTALL_VERIFY_FAILED: gettext('The app was not found on the iPhone after installation.')
  , IOS_INSTALL_FAILED: gettext('The iPhone could not install this IPA.')
  , INSTALL_SUCCEEDED: gettext('Installation succeeded.')
  , INSTALL_ERROR_UNKNOWN: gettext('Installation failed due to an unknown error.')
  , INSTALL_ERROR_TIMEOUT: gettext('Installation timed out.')
  , INSTALL_CANCELED_BY_USER: gettext('Installation canceled by user.')
  , INSTALL_FAILED_ALREADY_EXISTS: gettext('The package is already installed.')
  , INSTALL_FAILED_INVALID_APK: gettext('The package archive file is invalid.')
  , INSTALL_FAILED_INVALID_URI: gettext('The URI passed in is invalid.')
  , INSTALL_FAILED_INSUFFICIENT_STORAGE: gettext("The package manager service found that the device didn't have enough storage space to install the app.")
  , INSTALL_FAILED_DUPLICATE_PACKAGE: gettext('A package is already installed with the same name.')
  , INSTALL_FAILED_NO_SHARED_USER: gettext('The requested shared user does not exist.')
  , INSTALL_FAILED_UPDATE_INCOMPATIBLE: gettext("A previously installed package of the same name has a different signature than the new package (and the old package's data was not removed).")
  , INSTALL_FAILED_MISSING_SHARED_LIBRARY: gettext('The new package uses a shared library that is not available.')
  , INSTALL_FAILED_REPLACE_COULDNT_DELETE: gettext('The existing package could not be deleted.')
  , INSTALL_FAILED_DEXOPT: gettext('The new package failed while optimizing and validating its dex files, either because there was not enough storage or the validation failed.')
  , INSTALL_FAILED_OLDER_SDK: gettext('The new package failed because the current SDK version is older than that required by the package.')
  , INSTALL_FAILED_CONFLICTING_PROVIDER: gettext('The new package failed because it contains a content provider with thesame authority as a provider already installed in the system.')
  , INSTALL_FAILED_NEWER_SDK: gettext('The new package failed because the current SDK version is newer than that required by the package.')
  , INSTALL_FAILED_TEST_ONLY: gettext('The new package failed because it has specified that it is a test-only package and the caller has not supplied the INSTALL_ALLOW_TEST flag.')
  , INSTALL_FAILED_CPU_ABI_INCOMPATIBLE: gettext("The package being installed contains native code, but none that is compatible with the device's CPU_ABI.")
  , INSTALL_FAILED_MISSING_FEATURE: gettext('The new package uses a feature that is not available.')
  , INSTALL_FAILED_CONTAINER_ERROR: gettext("A secure container mount point couldn't be accessed on external media.")
  , INSTALL_FAILED_INVALID_INSTALL_LOCATION: gettext("The new package couldn't be installed in the specified install location.")
  , INSTALL_FAILED_MEDIA_UNAVAILABLE: gettext("The new package couldn't be installed in the specified install location because the media is not available.")
  , INSTALL_FAILED_VERIFICATION_TIMEOUT: gettext("The new package couldn't be installed because the verification timed out.")
  , INSTALL_FAILED_VERIFICATION_FAILURE: gettext("The new package couldn't be installed because the verification did not succeed.")
  , INSTALL_FAILED_PACKAGE_CHANGED: gettext('The package changed from what the calling program expected.')
  , INSTALL_FAILED_UID_CHANGED: gettext('The new package is assigned a different UID than it previously held.')
  , INSTALL_FAILED_VERSION_DOWNGRADE: gettext('The new package has an older version code than the currently installed package.')
  , INSTALL_PARSE_FAILED_NOT_APK: gettext("The parser was given a path that is not a file, or does not end with the expected '.apk' extension.")
  , INSTALL_PARSE_FAILED_BAD_MANIFEST: gettext('The parser was unable to retrieve the AndroidManifest.xml file.')
  , INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION: gettext('The parser encountered an unexpected exception.')
  , INSTALL_PARSE_FAILED_NO_CERTIFICATES: gettext('The parser did not find any certificates in the .apk.')
  , INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES: gettext('The parser found inconsistent certificates on the files in the .apk.')
  , INSTALL_PARSE_FAILED_CERTIFICATE_ENCODING: gettext('The parser encountered a CertificateEncodingException in one of the files in the .apk.')
  , INSTALL_PARSE_FAILED_BAD_PACKAGE_NAME: gettext('The parser encountered a bad or missing package name in the manifest.')
  , INSTALL_PARSE_FAILED_BAD_SHARED_USER_ID: gettext('The parser encountered a bad shared user id name in the manifest.')
  , INSTALL_PARSE_FAILED_MANIFEST_MALFORMED: gettext('The parser encountered some structural problem in the manifest.')
  , INSTALL_PARSE_FAILED_MANIFEST_EMPTY: gettext('The parser did not find any actionable tags (instrumentation or application) in the manifest.')
  , INSTALL_FAILED_INTERNAL_ERROR: gettext('The system failed to install the package because of system issues.')
  , INSTALL_FAILED_USER_RESTRICTED: gettext('The system failed to install the package because the user is restricted from installing apps.')
  , INSTALL_FAILED_NO_MATCHING_ABIS: gettext('The system failed to install the package because its packaged native code did not match any of the ABIs supported by the system.')
}

export function installStateText(state: string): string {
  const label = installStateLabels[state]
  return label ? translate(label) : state
}

export function installFailureText(code: string): string {
  const message = translate(installErrors[code] ?? code)
  return message === code ? message : `${message} (${code})`
}
