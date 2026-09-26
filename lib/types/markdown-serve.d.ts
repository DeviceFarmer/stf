declare module 'markdown-serve' {
  import express from 'express'

  interface MiddlewareOptions {
    rootDirectory: string
    view?: string
  }

  export function middleware(options: MiddlewareOptions): express.RequestHandler
}
