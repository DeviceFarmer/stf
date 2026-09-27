declare module 'hipchatter' {
  interface NotifyOptions {
    message: string
    color?: string | undefined
    notify?: boolean
    message_format?: 'html' | 'text'
    token?: string
  }

  class Hipchatter {
    constructor(token: string, api_root?: string)
    notify(
      room: string
    , options: NotifyOptions
    , callback: (error: Error | null, body?: unknown) => void
    ): void
  }

  export = Hipchatter
}
