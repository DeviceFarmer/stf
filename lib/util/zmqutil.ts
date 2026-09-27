//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

// ISSUE-100 (https://github.com/openstf/stf/issues/100)

// In some networks TCP Connection dies if kept idle for long.
// Setting TCP_KEEPALIVE option true, to all the zmq sockets
// won't let it die

import zmq from 'zeromq/v5-compat.js'

import logger from './logger.js'

var log = logger.createLogger('util:zmqutil')

var socket = function(..._args: Parameters<typeof zmq.socket>) {
  var sock = zmq.socket.apply(zmq, arguments as unknown as Parameters<typeof zmq.socket>)

  ;(['ZMQ_TCP_KEEPALIVE', 'ZMQ_TCP_KEEPALIVE_IDLE', 'ZMQ_IPV6'] as const).forEach(function(opt) {
    if (process.env[opt]) {
      try {
        sock.setsockopt(zmq[opt], Number(process.env[opt]))
      }
      catch (err) {
        log.warn('ZeroMQ library too old, no support for %s', opt)
      }
    }
  })

  return sock
}

export default {socket}
