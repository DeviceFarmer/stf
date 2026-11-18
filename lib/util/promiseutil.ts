import Promise from 'bluebird'

var periodicNotify = function<T>(
  promise: T | PromiseLike<T>
, interval: number
, notify: () => void
) {
  var timer = setInterval(notify, interval)

  return Promise.resolve(promise).finally(function() {
    clearInterval(timer)
  })
}

// Runs the tasks queued under one key one after another, in the order they were queued, while
// tasks under different keys still run side by side. A failed task does not hold up the next one.
var keyedQueue = function() {
  var tails = new Map<string, PromiseLike<unknown>>()

  return function<T>(key: string, task: () => T | PromiseLike<T>): Promise<T> {
    var result = Promise.resolve(tails.get(key)).then(task)
    var tail = result.catch(function() {})
    tails.set(key, tail)
    tail.then(function() {
      if (tails.get(key) === tail) {
        tails.delete(key)
      }
    })
    return result
  }
}

export default {periodicNotify, keyedQueue}
