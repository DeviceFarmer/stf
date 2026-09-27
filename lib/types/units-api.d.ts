import type express from 'express'
import type wirerouter from '../wire/router.js'
import type {AlertMessage, DeviceDocument, GroupDocument, UserDocument} from './stf.js'

export interface SwaggerParam<T> {
  value: T
}

export type DevicePayload = {
  note?: string
}

export type AdbKeyPayload = {
  publickey: string
  title?: string
}

export type ApiParams = {
  fields: SwaggerParam<string | undefined>
  owner: SwaggerParam<boolean | undefined>
  bookable: SwaggerParam<boolean | undefined>
  groupOwner: SwaggerParam<boolean | undefined>
  keepOwnership: SwaggerParam<boolean | undefined>
  present: SwaggerParam<boolean | undefined>
  booked: SwaggerParam<boolean | undefined>
  annotated: SwaggerParam<boolean | undefined>
  controlled: SwaggerParam<boolean | undefined>
  number: SwaggerParam<number | undefined>
  duration: SwaggerParam<number | undefined>
  repetitions: SwaggerParam<number | undefined>
  timeout: SwaggerParam<number | undefined>
  target: SwaggerParam<string | undefined>
  id: SwaggerParam<string>
  serial: SwaggerParam<string>
  email: SwaggerParam<string>
  name: SwaggerParam<string>
  title: SwaggerParam<string>
  device: SwaggerParam<DevicePayload & {device?: DevicePayload}>
  adb: SwaggerParam<AdbKeyPayload>
  redirected?: SwaggerParam<boolean>
}

export interface SwaggerContext {
  params: ApiParams
  operation: {
    definition: {
      tags: string[]
    }
  }
}

export type SerialsBody = {
  serials?: string
}

export type EmailsBody = {
  emails?: string
}

export type IdsBody = {
  ids?: string
}

export type GroupBody = {
  name?: string
  startTime?: string
  stopTime?: string
  class?: string
  repetitions?: number
  state?: string
}

export type AlertMessageBody = Partial<AlertMessage>

export type AddUserDeviceBody = {
  serial: string
  timeout?: number
}

export type NoBody = {
  [name: string]: unknown
}

export interface ApiRequest<B = NoBody>
  extends Omit<express.Request, 'body' | 'user' | 'options'> {
  swagger: SwaggerContext
  user: UserDocument
  body: B
  options: Express.ApiRequestOptions
}

export type SecurityRequest = express.Request & {
  swagger: SwaggerContext
  options: Express.ApiRequestOptions
}

export type ApiHandler<B = NoBody> = (req: ApiRequest<B>, res: express.Response) => unknown

export interface ApiLock {
  device?: DeviceDocument
  user?: UserDocument
  group?: GroupDocument
}

export type Responded = boolean | void

export type MessageListener = ReturnType<ReturnType<typeof wirerouter>['handler']>

export interface ApiUnitOptions {
  port: number
  ssid: string
  secret: string
  endpoints: {
    push: string[]
    sub: string[]
    pushdev: string[]
    subdev: string[]
  }
}
