import r from 'rethinkdb'
import Promise from 'bluebird'

import setup from './setup.js'
import logger from '../util/logger.js'
import lifecycle from '../util/lifecycle.js'
import srv from '../util/srv.js'

interface Database {
  connect(): Promise<r.Connection>
  ensureConnectivity<A extends unknown[], R>(
    fn: (...args: A) => R
  ): (...args: A) => Promise<Awaited<R>>
  close(options?: unknown): Promise<void>
  run<T>(q: r.Operation<T>, options?: Partial<r.OperationOptions> | r.RunCallback<T>): Promise<T>
  setup(): Promise<r.Connection>
}

var db: Database = Object.create(null)
var log = logger.createLogger('db')

function connect() {
  var options = {
    // These environment variables are exposed when we --link to a
    // RethinkDB container.
    url: process.env.RETHINKDB_PORT_28015_TCP || 'tcp://127.0.0.1:28015'
  , db: process.env.RETHINKDB_ENV_DATABASE || 'stf'
  , authKey: process.env.RETHINKDB_ENV_AUTHKEY
  }

  return srv.resolve(options.url)
    .then(function(records: {name: string | null, port: number | string | null}[]) {
      function next(): Promise<r.Connection> {
        var record = records.shift()

        if (!record) {
          throw new Error('No hosts left to try')
        }

        log.info('Connecting to %s:%d', record.name, record.port)

        return r.connect({
            host: record.name as string
          , port: record.port as number
          , db: options.db
          , authKey: options.authKey
          })
          .catch(r.Error.RqlDriverError, function(): Promise<r.Connection> {
            log.info('Unable to connect to %s:%d', record!.name, record!.port)
            return next()
          })
      }

      return next()
    })
}

// Export connection as a Promise
db.connect = (function() {
  var connection: r.Connection | null
  var queue: {resolve: (conn: r.Connection) => void, reject: (err: unknown) => void}[] = []
  var goingDown = false

  lifecycle.observe(function() {
    goingDown = true
    if (connection) {
      return connection.close()
    }
    return Promise.resolve()
  })

  function createConnection() {
    return connect()
      .then(function(conn: r.Connection) {
        connection = conn

        conn.on('close', function closeListener() {
          log.warn('Connection closed')
          connection = null
          conn.removeListener('close', closeListener)
          if (!goingDown) {
            createConnection()
          }
        })

        queue.splice(0).forEach(function(resolver) {
          resolver.resolve(conn)
        })

        return conn
      })
      .catch(function(err: Error) {
        log.fatal(err.message)
        lifecycle.fatal()
      })
  }

  createConnection()

  return function() {
    return new Promise<r.Connection>(function(resolve, reject) {
      if (connection) {
        resolve(connection)
      }
      else {
        queue.push({
          resolve: resolve
        , reject: reject
        })
      }
    })
  }
})()

// Verifies that we can form a connection. Useful if it's necessary to make
// sure that a handler doesn't run at all if the database is on a break. In
// normal operation connections are formed lazily. In particular, this was
// an issue with the processor unit, as it started processing messages before
// it was actually truly able to save anything to the database. This lead to
// lost messages in certain situations.
db.ensureConnectivity = function<A extends unknown[], R>(fn: (...args: A) => R) {
  return function() {
    var args = [].slice.call(arguments) as unknown as A
    return db.connect().then(function() {
      return fn.apply(null, args)
    }) as Promise<Awaited<R>>
  }
}

// Close connection, we don't really care if it hasn't been created yet or not
db.close = function() {
  return db.connect().then(function(conn) {
    return conn.close()
  })
}

// Small utility for running queries without having to acquire a connection
db.run = function(q, options) {
  return db.connect().then(function(conn) {
    return q.run(conn, options)
  })
}

// Sets up the database
db.setup = function() {
  return db.connect().then(function(conn) {
    return setup(conn)
  })
}

export default db
