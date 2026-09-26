declare module '@targetprocess/swagger-tools/middleware/swagger-ui.js' {
  import express from 'express'

  interface SwaggerUiOptions {
    apiDocs?: string
    swaggerUi?: string
    swaggerUiDir?: string
  }

  function swaggerUi(swaggerObject: object, options?: SwaggerUiOptions): express.RequestHandler

  export = swaggerUi
}
