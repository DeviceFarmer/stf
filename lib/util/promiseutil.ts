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

export default {periodicNotify}
