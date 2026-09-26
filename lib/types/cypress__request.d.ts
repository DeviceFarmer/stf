declare module '@cypress/request' {
  import http from 'http'
  import stream from 'stream'
  import FormData from 'form-data'

  namespace request {
    interface Options {
      url: string
      json?: boolean
      body?: unknown
    }

    interface TextOptions extends Options {
      json?: false
    }

    type Callback = (error: Error | null, response: http.IncomingMessage, body: string) => void

    class Request extends stream.Stream {
      pipe<T extends NodeJS.WritableStream>(destination: T, options?: {end?: boolean}): T
      form(): FormData
      on(event: 'response', listener: (response: http.IncomingMessage) => void): this
      on(event: 'error', listener: (error: Error) => void): this
      on(event: string | symbol, listener: (...args: any[]) => void): this
    }

    function get(uri: string | TextOptions, callback?: Callback): Request
    function post(uri: string | TextOptions, callback?: Callback): Request
  }

  function request(uri: string | request.TextOptions, callback?: request.Callback): request.Request

  export = request
}
