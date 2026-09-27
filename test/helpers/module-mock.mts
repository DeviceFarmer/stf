import {registerHooks} from 'node:module'

type ModuleExports = Record<string, unknown>

var registry = Symbol.for('stf.test.moduleMocks')
var store = new Map<string, ModuleExports>()
var active = new Map<string, string>()
var counter = 0

;(globalThis as Record<symbol, unknown>)[registry] = store

function mockSource(url: string, exports: ModuleExports) {
  var lines = [
    'var mock = globalThis[Symbol.for(' + JSON.stringify(registry.description) + ')]' +
      '.get(' + JSON.stringify(url) + ')'
  ]
  Object.keys(exports).forEach(function(name) {
    if (name === 'default') {
      lines.push('export default mock.default')
    }
    else {
      lines.push('export var ' + name + ' = mock[' + JSON.stringify(name) + ']')
    }
  })
  return lines.join('\n')
}

registerHooks({
  resolve: function(specifier, context, nextResolve) {
    var resolved = nextResolve(specifier, context)
    var mockUrl = active.get(resolved.url)
    if (mockUrl) {
      return {url: mockUrl, format: 'module', shortCircuit: true}
    }
    return resolved
  }
, load: function(url, context, nextLoad) {
    var exports = store.get(url)
    if (exports) {
      return {format: 'module', source: mockSource(url, exports), shortCircuit: true}
    }
    return nextLoad(url, context)
  }
})

export function mockModule(target: URL, exports: ModuleExports) {
  var mockUrl = 'stf-mock:' + (++counter) + ':' + target.href
  store.set(mockUrl, exports)
  active.set(target.href, mockUrl)
  return function() {
    if (active.get(target.href) === mockUrl) {
      active.delete(target.href)
    }
  }
}

export function importFresh(target: URL): Promise<any> {
  var fresh = new URL(target.href)
  fresh.searchParams.set('fresh', String(++counter))
  return import(fresh.href)
}
