declare module '@devicefarmer/stf-syrup' {
  import Bluebird from 'bluebird'

  namespace syrup {
    type Body<T> = (options: never, ...dependencies: never[]) => T

    interface Syrup<T = unknown, B = unknown> {
      define<R>(body: Body<R>): Syrup<Awaited<R>, R>
      dependency(dep: Syrup): this
      consume(overrides?: object): Bluebird<T>
      invoke(overrides?: object | null, ...dependencies: unknown[]): B
    }

    function serial(options?: object): Syrup
  }

  function syrup(options?: object): syrup.Syrup

  export = syrup
}
