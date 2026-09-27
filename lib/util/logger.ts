/* eslint quote-props:0 */
import util from 'util'
import events from 'events'

import chalk from 'chalk'
import type {ForegroundColorName} from 'chalk'

interface LogEntry {
  timestamp: Date
  priority: number
  tag: string
  pid: number
  identifier: string
  message: string
}

type LogEntryConstructor = new(
  timestamp: Date
, priority: number
, tag: string
, pid: number
, identifier: string
, message: string
) => LogEntry

interface Log extends events.EventEmitter {
  tag: string
  names: Record<number, string>
  styles: Record<number, string>
  localIdentifier: string | null | undefined
  setLocalIdentifier(identifier: string | null | undefined): void
  debug(...args: unknown[]): void
  verbose(...args: unknown[]): void
  info(...args: unknown[]): void
  important(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  fatal(...args: unknown[]): void
  _entry(priority: number, args: IArguments): LogEntry
  _format(entry: LogEntry): string
  _name(priority: number): string
  _write(entry: LogEntry): void
}

interface LoggerModule extends events.EventEmitter {
  Level: {
    DEBUG: number
    VERBOSE: number
    INFO: number
    IMPORTANT: number
    WARNING: number
    ERROR: number
    FATAL: number
  }
  LevelLabel: Record<number, string>
  globalIdentifier: string
  createLogger(tag: string): Log
  setGlobalIdentifier(identifier: string): LoggerModule
}

var Logger = new events.EventEmitter() as LoggerModule

Logger.Level = {
  DEBUG: 1
, VERBOSE: 2
, INFO: 3
, IMPORTANT: 4
, WARNING: 5
, ERROR: 6
, FATAL: 7
}

// Exposed for other modules
Logger.LevelLabel = {
  1: 'DBG'
, 2: 'VRB'
, 3: 'INF'
, 4: 'IMP'
, 5: 'WRN'
, 6: 'ERR'
, 7: 'FTL'
}

Logger.globalIdentifier = '*'

function Log(this: Log, tag: string) {
  this.tag = tag
  this.names = {
    1: 'DBG'
  , 2: 'VRB'
  , 3: 'INF'
  , 4: 'IMP'
  , 5: 'WRN'
  , 6: 'ERR'
  , 7: 'FTL'
  }
  this.styles = {
    1: 'grey'
  , 2: 'cyan'
  , 3: 'green'
  , 4: 'magenta'
  , 5: 'yellow'
  , 6: 'red'
  , 7: 'red'
  }
  this.localIdentifier = null
  events.EventEmitter.call(this)
}

util.inherits(Log, events.EventEmitter)

Logger.createLogger = function(tag: string) {
  return new (Log as unknown as new(tag: string) => Log)(tag)
}

Logger.setGlobalIdentifier = function(identifier: string) {
  Logger.globalIdentifier = identifier
  return Logger
}

Log.Entry = function(
  this: LogEntry
, timestamp: Date
, priority: number
, tag: string
, pid: number
, identifier: string
, message: string
) {
  this.timestamp = timestamp
  this.priority = priority
  this.tag = tag
  this.pid = pid
  this.identifier = identifier
  this.message = message
}

Log.prototype.setLocalIdentifier = function(this: Log, identifier: string | null | undefined) {
  this.localIdentifier = identifier
}

Log.prototype.debug = function(this: Log) {
  this._write(this._entry(Logger.Level.DEBUG, arguments))
}

Log.prototype.verbose = function(this: Log) {
  this._write(this._entry(Logger.Level.VERBOSE, arguments))
}

Log.prototype.info = function(this: Log) {
  this._write(this._entry(Logger.Level.INFO, arguments))
}

Log.prototype.important = function(this: Log) {
  this._write(this._entry(Logger.Level.IMPORTANT, arguments))
}

Log.prototype.warn = function(this: Log) {
  this._write(this._entry(Logger.Level.WARNING, arguments))
}

Log.prototype.error = function(this: Log) {
  this._write(this._entry(Logger.Level.ERROR, arguments))
}

Log.prototype.fatal = function(this: Log) {
  this._write(this._entry(Logger.Level.FATAL, arguments))
}

Log.prototype._entry = function(this: Log, priority: number, args: IArguments) {
  return new (Log.Entry as unknown as LogEntryConstructor)(
      new Date()
    , priority
    , this.tag
    , process.pid
    , this.localIdentifier || Logger.globalIdentifier
    , util.format.apply(util, args as unknown as Parameters<typeof util.format>)
  )
}

Log.prototype._format = function(this: Log, entry: LogEntry) {
  return util.format('%s %s/%s %d [%s] %s'
    , chalk.grey(entry.timestamp.toJSON())
    , this._name(entry.priority)
    , chalk.bold(entry.tag)
    , entry.pid
    , entry.identifier
    , entry.message
  )
}

Log.prototype._name = function(this: Log, priority: number) {
  return chalk[this.styles[priority] as ForegroundColorName](this.names[priority])
}

/* eslint no-console: 0 */
Log.prototype._write = function(this: Log, entry: LogEntry) {
  console.error(this._format(entry))
  this.emit('entry', entry)
  Logger.emit('entry', entry)
}

namespace Logger {
  export type Entry = LogEntry
  export type Instance = Log
}

export default Logger
