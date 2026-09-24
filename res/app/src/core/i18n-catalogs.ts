export type Catalog = Record<string, string | string[]>

declare const require: {
  context(dir: string, deep: boolean, pattern: RegExp): {
    keys(): string[]
    (id: string): Record<string, Catalog>
  }
}

const context = require.context('../../../common/lang/translations', false, /^\.\/stf\..+\.json$/)

export const catalogs: Record<string, Catalog> = {}

for (const key of context.keys()) {
  Object.assign(catalogs, context(key))
}
