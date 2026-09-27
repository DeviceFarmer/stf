import url from 'url'
import util from 'util'

import Promise from 'bluebird'
import nodeDns from 'dns'
import type {SrvRecord} from 'dns'

var dns = Promise.promisifyAll(nodeDns) as unknown as {
  resolveSrvAsync(hostname: string): Promise<SrvRecord[]>
}

interface ResolvedSrvRecord extends SrvRecord {
  url: string
}

interface ResolvedPlainRecord {
  url: string
  name: string | null
  port: string | null
}

type ResolvedRecord = ResolvedSrvRecord | ResolvedPlainRecord

interface Srv {
  NEXT: typeof NEXT
  sort<R extends SrvRecord>(records: R[]): R[]
  resolve(domain: string): Promise<ResolvedRecord[]>
  attempt<R, T>(records: R[], fn: (record: R) => Promise<T>): Promise<T>
}

var srv: Srv = Object.create(null)

function groupByPriority<R extends SrvRecord>(records: R[]) {
  function sortByPriority(a: R, b: R) {
    return a.priority - b.priority
  }

  return records.sort(sortByPriority).reduce(function(acc: R[][], record) {
    if (acc.length) {
      var last = acc[acc.length - 1]!
      if (last[0]!.priority !== record.priority) {
        acc.push([record])
      }
      else {
        last.push(record)
      }
    }
    else {
      acc.push([record])
    }
    return acc
  }, [])
}

function shuffleWeighted<R extends SrvRecord>(records: R[]) {
  function sortByWeight(a: R, b: R) {
    return b.weight - a.weight
  }

  function totalWeight(records: R[]) {
    return records.reduce(function(sum: number, record) {
      return sum + record.weight
    }, 0)
  }

  function pick(records: R[], sum: number): R[] {
    var rand = Math.random() * sum
    var counter = 0

    for (var i = 0, l = records.length; i < l; ++i) {
      counter += records[i]!.weight
      if (rand < counter) {
        var picked = records.splice(i, 1)
        return picked.concat(pick(records, sum - picked[0]!.weight))
      }
    }

    return []
  }

  return pick(records.sort(sortByWeight), totalWeight(records))
}

function flatten<R>(groupedRecords: R[][]) {
  return groupedRecords.reduce(function(acc: R[], group) {
    return acc.concat(group)
  }, [])
}

class NEXT extends Error {
  constructor() {
    super()
    this.name = 'NEXT'
    Error.captureStackTrace(this, NEXT)
  }
}

srv.NEXT = NEXT

srv.sort = function<R extends SrvRecord>(records: R[]) {
  return flatten(groupByPriority(records).map(shuffleWeighted))
}

srv.resolve = function(domain: string) {
  var parsedUrl = url.parse(domain)

  if (!parsedUrl.protocol) {
    return Promise.reject(new Error(util.format(
      'Must include protocol in "%s"'
    , domain
    )))
  }

  if (/^srv\+/.test(parsedUrl.protocol)) {
    parsedUrl.protocol = parsedUrl.protocol.substr(4)
    return dns.resolveSrvAsync(parsedUrl.hostname!)
      .then(srv.sort)
      .then(function(records) {
        return records.map(function(record) {
          parsedUrl.host = util.format('%s:%d', record.name, record.port)
          parsedUrl.hostname = record.name
          parsedUrl.port = record.port as unknown as string
          ;(record as ResolvedSrvRecord).url = url.format(parsedUrl)
          return record as ResolvedSrvRecord
        })
      })
  }
  else {
    return Promise.resolve([{
      url: domain
    , name: parsedUrl.hostname
    , port: parsedUrl.port
    }])
  }
}

srv.attempt = function<R, T>(records: R[], fn: (record: R) => Promise<T>) {
  function next(i: number): Promise<T> {
    if (i >= records.length) {
      throw new Error('No more records left to try')
    }

    return fn(records[i]!).catch(srv.NEXT, function() {
      return next(i + 1)
    })
  }

  return next(0)
}

export default srv
