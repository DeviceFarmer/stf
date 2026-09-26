import oauth2 from 'passport-oauth2'

class Strategy extends oauth2.Strategy {
  declare _userinfoURL: string

  constructor(
    options: oauth2.StrategyOptions & {userinfoURL: string}
  , verify: oauth2.VerifyFunction
  ) {
    super(options, verify)
    if (!options.userinfoURL) {
      throw new TypeError('OAuth2Strategy requires a userinfoURL option')
    }
    this._userinfoURL = options.userinfoURL
    this._oauth2.useAuthorizationHeaderforGET(true)
  }

  userProfile(accessToken: string, callback: (err?: unknown, profile?: Express.User) => void) {
    this._oauth2.get(this._userinfoURL, accessToken, function(err, data) {
      if (err) {
        return callback(err)
      }

      try {
        return callback(null, JSON.parse(data as string))
      }
      catch (err) {
        return callback(err)
      }
    })
  }
}

export default Strategy
