import assert from 'assert'
import jws from 'jws'
import _ from 'lodash'

interface JwtPayload {
  email: string
  name: string
}

interface EncodeOptions {
  payload: JwtPayload
  secret: string
  header?: Partial<jws.Header>
}

var encode = function(options: EncodeOptions) {
  assert.ok(options.payload, 'payload required')
  assert.ok(options.secret, 'secret required')

  var header: jws.Header = {
    alg: 'HS256'
  }

  if (options.header) {
    header = _.merge(header, options.header)
  }

  return jws.sign({
    header: header
  , payload: options.payload
  , secret: options.secret
  })
}

var decode = function(payload: string, secret: string): JwtPayload | null {
  if (!jws.verify(payload, 'HS256', secret)) {
    return null
  }

  var decoded = jws.decode(payload, {
        json: true
      })!
  var exp = decoded.header.exp

  if (exp && exp <= Date.now()) {
    return null
  }

  return decoded.payload
}

export default {encode, decode}
