import r from 'rethinkdb'
import Promise from 'bluebird'

import logger from '../util/logger.js'
import tables from './tables.js'
import type {DbIndexSpec, DbTableSpec} from '../types/stf.js'

type IndexCreate = (...args: unknown[]) => r.Operation<r.CreateResult>

export default function(conn: r.Connection) {
  var log = logger.createLogger('db:setup')

  function alreadyExistsError(err: {msg?: string}) {
    return err.msg && err.msg.indexOf('already exists') !== -1
  }

  function noMasterAvailableError(err: {msg?: string}) {
    return err.msg && err.msg.indexOf('No master available') !== -1
  }

  function createDatabase() {
    return r.dbCreate(conn.db!).run(conn)
      .then(function() {
        log.info('Database "%s" created', conn.db)
      })
      .catch(alreadyExistsError, function() {
        log.info('Database "%s" already exists', conn.db)
        return Promise.resolve()
      })
  }

  function createIndex(table: string, index: string, options: DbIndexSpec): Promise<void> {
    var args: unknown[] = [index]
    var rTable = r.table(table)

    if (options) {
      if (options.indexFunction) {
        args.push(options.indexFunction)
      }
      if (options.options) {
        args.push(options.options)
      }
    }

    return (rTable.indexCreate as IndexCreate).apply(rTable, args).run(conn)
      .then(function() {
        log.info('Index "%s"."%s" created', table, index)
      })
      .catch(alreadyExistsError, function() {
        log.info('Index "%s"."%s" already exists', table, index)
        return Promise.resolve()
      })
      .then(function() {
        log.info('Waiting for index "%s"."%s"', table, index)
        return r.table(table).indexWait(index).run(conn)
      })
      .then(function() {
        log.info('Index "%s"."%s" is ready', table, index)
        return Promise.resolve()
      })
      .catch(noMasterAvailableError, function() {
        return Promise.delay(1000).then(function() {
          return createIndex(table, index, options)
        })
      })
  }

  function createTable(table: string, options: DbTableSpec): Promise<void | void[]> {
    var tableOptions = {
      primaryKey: options.primaryKey
    }
    return r.tableCreate(table, tableOptions).run(conn)
      .then(function() {
        log.info('Table "%s" created', table)
      })
      .catch(alreadyExistsError, function() {
        log.info('Table "%s" already exists', table)
        return Promise.resolve()
      })
      .catch(noMasterAvailableError, function() {
        return Promise.delay(1000).then(function() {
          return createTable(table, options)
        })
      })
      .then<void | void[]>(function() {
        if (!options.indexes) {
          return Promise.resolve()
        }
        return Promise.all(Object.keys(options.indexes).map(function(index) {
          return createIndex(table, index, options.indexes![index]!)
        }))
      })
  }

  return createDatabase()
    .then(function() {
      return Promise.all(Object.keys(tables).map(function(table) {
        return createTable(table, tables[table]!)
      }))
    })
    .return(conn)
}
