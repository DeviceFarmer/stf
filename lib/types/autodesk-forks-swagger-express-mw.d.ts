declare module 'autodesk-forks-swagger-express-mw' {
  import express from 'express'

  interface Config {
    appRoot: string
    swaggerFile?: string
  }

  interface Middleware {
    runner: {
      swagger: object
    }
    register(app: express.Application): void
  }

  export function create(
    config: Config
  , cb: (err: Error | undefined, middleware: Middleware) => void
  ): void
}
