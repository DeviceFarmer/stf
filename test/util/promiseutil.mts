import * as chai from 'chai'
var expect = chai.expect

import promiseutil from '../../lib/util/promiseutil.js'

function deferred() {
  var resolve!: () => void, reject!: (err: Error) => void
  var promise = new Promise<void>(function(res, rej) {
    resolve = res
    reject = rej
  })
  return {promise, resolve, reject}
}

describe('promiseutil.keyedQueue', function() {
  // A kick followed by someone taking the device: the leave's write is slow, the join's fast
  it('should run a task only after the earlier task under the same key settles', async function() {
    var queue = promiseutil.keyedQueue()
    var order: string[] = []
    var slow = deferred()

    var first = queue('serial', function() {
      return slow.promise.then(function() {
        order.push('leave')
      })
    })
    var second = queue('serial', function() {
      order.push('join')
    })

    await new Promise(function(resolve) {
      setTimeout(resolve, 10)
    })
    expect(order).to.deep.equal([])
    slow.resolve()
    await Promise.all([first, second])
    expect(order).to.deep.equal(['leave', 'join'])
  })

  it('should not hold up a task under another key', async function() {
    var queue = promiseutil.keyedQueue()
    var slow = deferred()

    queue('a', function() {
      return slow.promise
    })
    var other = await queue('b', function() {
      return 'done'
    })

    expect(other).to.equal('done')
    slow.resolve()
  })

  it('should run the next task when an earlier one fails, and report each own result',
    async function() {
      var queue = promiseutil.keyedQueue()

      var failed = queue('serial', function() {
        return Promise.reject(new Error('write failed'))
      })
      var next = queue('serial', function() {
        return 42
      })

      var err = await failed.then(function() {
        return null
      }, function(e: Error) {
        return e
      })
      expect(err?.message).to.equal('write failed')
      expect(await next).to.equal(42)
    })
})
