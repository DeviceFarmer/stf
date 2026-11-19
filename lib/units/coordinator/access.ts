import {createHash, timingSafeEqual} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {CoordinatorError} from './config.js'

export interface ProjectPolicy {
  id: string
  tokenSha256: string
  maxParallel: number
}

export interface Principal {
  projectId: string
  admin: boolean
}

const digest = (token: string) => createHash('sha256').update(token).digest()

/** Project files contain token digests; plaintext worker credentials stay in CI secrets. */
export class CoordinatorAccess {
  private readonly operatorHash: Buffer
  private readonly projects: {policy: ProjectPolicy, hash: Buffer}[]

  constructor(operatorToken: string, policies: ProjectPolicy[] = []) {
    this.operatorHash = digest(operatorToken)
    const ids = new Set<string>()
    const hashes = new Set<string>([this.operatorHash.toString('hex')])
    for (const policy of policies) {
      if (!policy || typeof policy.id !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(policy.id) ||
          policy.id === 'legacy' || ids.has(policy.id) ||
          typeof policy.tokenSha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(policy.tokenSha256) || hashes.has(policy.tokenSha256) ||
          !Number.isSafeInteger(policy.maxParallel) || policy.maxParallel < 1) {
        throw new Error('Invalid or duplicate coordinator project policy')
      }
      ids.add(policy.id)
      hashes.add(policy.tokenSha256)
    }
    this.projects = policies.map(policy => ({policy: {...policy}
      , hash: Buffer.from(policy.tokenSha256, 'hex')}))
  }

  static async load(operatorToken: string, filename?: string) {
    if (!filename) {
 return new CoordinatorAccess(operatorToken)
}
    const value: unknown = JSON.parse(await readFile(filename, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        (value as {version?: unknown}).version !== 1 ||
        !Array.isArray((value as {projects?: unknown}).projects)) {
      throw new Error('Expected coordinator project policy version 1')
    }
    return new CoordinatorAccess(operatorToken,
      (value as {projects: ProjectPolicy[]}).projects)
  }

  authenticate(header: string | undefined): Principal | null {
    let token = ''
    if (header?.startsWith('Bearer ')) {
 token = header.slice(7)
}
    else if (header?.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString()
      if (decoded.startsWith('coordinator:')) {
 token = decoded.slice('coordinator:'.length)
}
    }
    if (!token || token.length > 4096) {
 return null
}
    const supplied = digest(token)
    const admin = timingSafeEqual(supplied, this.operatorHash)
    let matched: string | null = null
    for (const project of this.projects) {
      if (timingSafeEqual(supplied, project.hash)) {
 matched = project.policy.id
}
    }
    if (admin) {
      return {projectId: 'legacy', admin: true}
    }
    if (matched) {
      return {projectId: matched, admin: false}
    }
    return null
  }

  limits() {
    return new Map(this.projects.map(({policy}) => [policy.id, policy.maxParallel]))
  }

  assertProject(principal: Principal, projectId: string, kind: 'lease' | 'request') {
    if (!principal.admin && principal.projectId !== projectId) {
      throw new CoordinatorError(404, kind + '_not_found', 'Resource not found')
    }
  }

  assertAdmin(principal: Principal) {
    if (!principal.admin) {
      throw new CoordinatorError(403, 'operator_required', 'Coordinator operator required')
    }
  }
}
