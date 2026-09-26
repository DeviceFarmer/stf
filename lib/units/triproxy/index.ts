/**
* Copyright © 2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

import logger from '../../util/logger.js'
import lifecycle from '../../util/lifecycle.js'
import zmqutil from '../../util/zmqutil.js'

interface TriproxyOptions {
  name?: string
  endpoints: {
    pub: string
    dealer: string
    pull: string
  }
}

export default function(options: TriproxyOptions) {
  var log = logger.createLogger('triproxy')

  if (options.name) {
    logger.setGlobalIdentifier(options.name)
  }

  function proxy(to: ReturnType<typeof zmqutil.socket>) {
    return function() {
      to.send([].slice.call(arguments))
    }
  }

  // App/device output
  var pub = zmqutil.socket('pub')
  pub.bind(options.endpoints.pub)
  log.info('PUB socket bound on', options.endpoints.pub)

  // Coordinator input/output
  var dealer = zmqutil.socket('dealer')
  dealer.bind(options.endpoints.dealer)
  dealer.on('message', proxy(pub))
  log.info('DEALER socket bound on', options.endpoints.dealer)

  // App/device input
  var pull = zmqutil.socket('pull')
  pull.bind(options.endpoints.pull)
  pull.on('message', proxy(dealer))
  log.info('PULL socket bound on', options.endpoints.pull)

  lifecycle.observe(function() {
    [pub, dealer, pull].forEach(function(sock) {
      try {
        sock.close()
      }
      catch (err) {
        // No-op
      }
    })
  })
}
