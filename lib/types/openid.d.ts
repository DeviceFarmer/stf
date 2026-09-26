import 'openid'

declare module 'openid' {
  type SimpleRegistrationField = boolean | 'required'

  interface SimpleRegistrationOptions {
    email?: SimpleRegistrationField
    fullname?: SimpleRegistrationField
  }

  class SimpleRegistration {
    constructor(options: SimpleRegistrationOptions)
  }
}
