//
// Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
//

import cp from 'node:child_process'
import fs from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'

import type protobufjs from 'protobufjs'
import type {Diagnostic} from 'typescript'
import type {Configuration, Stats} from 'webpack'

var requireFromRoot = createRequire(import.meta.url)

function runCommand(command: string, args: string[]) {
  return new Promise<void>(function(resolve, reject) {
    var child = cp.spawn(command, args, {
      stdio: 'inherit'
    , env: Object.assign({}, process.env, {
        PATH: path.join(import.meta.dirname, 'node_modules', '.bin') +
          path.delimiter + process.env.PATH
      })
    })
    child.on('error', reject)
    child.on('exit', function(code, signal) {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error([command].concat(args).join(' ') + ' exited with ' +
        (signal ? 'signal ' + signal : 'code ' + code)))
    })
  })
}

async function jsonlint() {
  var files = fs.readdirSync('.', {withFileTypes: true})
    .filter(function(entry) {
      return entry.isFile() && !entry.name.startsWith('.') && entry.name.endsWith('.json')
    })
    .map(function(entry) {
      return entry.name
    })
  if (fs.existsSync('.yo-rc.json')) {
    files.unshift('.yo-rc.json')
  }
  var invalid = files.filter(function(file) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'))
      return false
    }
    catch (error) {
      console.error(file + ': ' + (error as Error).message)
      return true
    }
  })
  if (invalid.length > 0) {
    throw new Error('Invalid JSON in ' + invalid.join(', '))
  }
}

async function eslint() {
  var ESLint = (await import('eslint')).ESLint
  var cli = new ESLint({
    cache: true
  , fix: false
  , errorOnUnmatchedPattern: false
  })

  var results = await cli.lintFiles([
    'lib/**/*.ts'
    , 'res/app/src/**/*.{ts,tsx}'
    , 'res/app/*.ts'
    , 'res/common/**/*.{ts,mts}'
    , '*.{ts,mts}'
    , 'test/**/*.mts'
    , 'test/playwright/**/*.ts'
    , '.github/scripts/**/*.mts'
  ])
  var formatter = await cli.loadFormatter('stylish')
  console.log(await formatter.format(results))

  var errorCount = results.reduce(function(total, result) {
    return total + result.errorCount
  }, 0)

  if (errorCount > 0) {
    throw new Error('ESLint error')
  }
}

async function checkversion() {
  console.log('Checking STF version...')
  await runCommand('./bin/stf', ['-V'])
}

interface WireTypesOptions {
  proto: string
  namespace?: string
  out: string
  name: string
  codes: boolean
}

async function writeWireTypes(options: WireTypesOptions) {
  var protobuf = (await import('protobufjs')).default
  var root = new protobuf.Root().loadSync(options.proto, {keepCase: true})
  root.resolveAll()
  var namespace = (options.namespace ?
    root.lookup(options.namespace) :
    root) as protobufjs.Namespace
  var scalars: Record<string, string> = {
    double: 'number'
  , float: 'number'
  , int32: 'number'
  , uint32: 'number'
  , sint32: 'number'
  , fixed32: 'number'
  , sfixed32: 'number'
  , bool: 'boolean'
  , string: 'string'
  , bytes: 'Buffer'
  }
  var types = namespace.nestedArray.filter(function(nested): nested is protobufjs.Type {
    return nested instanceof protobuf.Type
  })
  var enums = namespace.nestedArray.filter(function(nested): nested is protobufjs.Enum {
    return nested instanceof protobuf.Enum
  })
  function valueType(field: protobufjs.Field) {
    if (field.resolvedType instanceof protobuf.Type) {
      return field.resolvedType.name
    }
    if (field.resolvedType instanceof protobuf.Enum) {
      return 'number'
    }
    if (!scalars[field.type]) {
      throw new Error(options.proto + ' uses the unsupported protobuf type ' + field.type)
    }
    return scalars[field.type]
  }
  var reserved = [
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do'
  , 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import'
  , 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try'
  , 'typeof', 'var', 'void', 'while', 'with'
  ]
  function parameterName(field: protobufjs.Field) {
    return reserved.indexOf(field.name) === -1 ? field.name : field.name + 'Value'
  }
  function argumentType(field: protobufjs.Field) {
    var type = valueType(field)
    if (field.resolvedType instanceof protobuf.Enum) {
      type = 'number | string'
    }
    if (field.resolvedType instanceof protobuf.Type) {
      type = '(' + type + ' | Partial<' + type + 'Fields>)'
    }
    return field.repeated ? 'Array<' + type + '>' : type
  }
  function fieldType(field: protobufjs.Field) {
    if (field.repeated) {
      return valueType(field) + '[]'
    }
    return field.required ? valueType(field) : valueType(field) + ' | null'
  }
  var lines: string[] = []
  enums.forEach(function(type) {
    lines.push('export interface ' + type.name + 'Values {')
    Object.keys(type.values).forEach(function(name) {
      lines.push('  readonly ' + name + ': ' + type.values[name])
    })
    lines.push('}', '')
  })
  types.forEach(function(type) {
    lines.push('export interface ' + type.name + 'Fields {')
    type.fieldsArray.forEach(function(field) {
      lines.push('  ' + field.name + ': ' + fieldType(field))
    })
    lines.push('}', '')
    lines.push('export interface ' + type.name + ' extends ' + type.name + 'Fields {')
    if (options.codes) {
      lines.push('  $code: number')
    }
    lines.push('  encode(): Buffer', '  encodeNB(): Buffer', '}', '')
    lines.push('export interface ' + type.name + 'Constructor {')
    lines.push('  new(values: Partial<' + type.name + 'Fields>): ' + type.name)
    lines.push('  new(' + type.fieldsArray.map(function(field) {
      return parameterName(field) + '?: ' + argumentType(field) + ' | null'
    }).join(', ') + '): ' + type.name)
    lines.push('  decode(buffer: Buffer | Uint8Array): ' + type.name)
    if (options.codes) {
      lines.push('  $code: number')
    }
    lines.push('  prototype: ' + type.name, '}', '')
  })
  lines.push('export interface ' + options.name + ' {')
  enums.forEach(function(type) {
    lines.push('  ' + type.name + ': ' + type.name + 'Values')
  })
  types.forEach(function(type) {
    lines.push('  ' + type.name + ': ' + type.name + 'Constructor')
  })
  if (options.codes) {
    lines.push('  ReverseMessageType: Record<number, keyof MessageTypeValues>')
  }
  lines.push('}', '')
  fs.mkdirSync(path.dirname(options.out), {recursive: true})
  fs.writeFileSync(options.out, lines.join('\n'))
}

async function wireTypes() {
  await writeWireTypes({
    proto: path.join(process.cwd(), 'lib', 'wire', 'wire.proto')
  , out: path.join(process.cwd(), 'lib', 'types', 'wire.d.ts')
  , name: 'Wire'
  , codes: true
  })
  await writeWireTypes({
    proto: requireFromRoot.resolve('@devicefarmer/stfservice-prebuilt/prebuilt/noarch/wire.proto')
  , namespace: 'jp.co.cyberagent.stf.proto'
  , out: path.join(process.cwd(), 'lib', 'types', 'stfservice-wire.d.ts')
  , name: 'StfServiceWire'
  , codes: false
  })
}

async function typecheck() {
  await runCommand('tsc', ['-p', 'res/app/tsconfig.json'])
  await runCommand('tsc', ['-p', 'lib/tsconfig.json', '--noEmit'])
  await runCommand('tsc', ['-p', 'tsconfig.json'])
}

async function compile() {
  var ts = (await import('typescript')).default
  var configPath = path.join(process.cwd(), 'lib', 'tsconfig.json')
  var host = Object.assign({}, ts.sys, {
    onUnRecoverableConfigFileDiagnostic: function(diagnostic: Diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    }
  })
  var config = ts.getParsedCommandLineOfConfigFile(configPath, {}, host)
  if (!config) {
    throw new Error('Unable to read ' + configPath)
  }
  var program = ts.createProgram(config.fileNames, config.options)
  var result = program.emit()
  var diagnostics = config.errors.concat(ts.getPreEmitDiagnostics(program), result.diagnostics)
  if (diagnostics.length === 0) {
    return
  }
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: function(fileName: string) {
      return fileName
    }
  , getCurrentDirectory: ts.sys.getCurrentDirectory
  , getNewLine: function() {
      return ts.sys.newLine
    }
  }))
  throw new Error('TypeScript error')
}

async function clean() {
  await Promise.all([
    './tmp'
    , './res/build'
    , '.eslintcache'
  ].map(function(target) {
    return fs.promises.rm(target, {recursive: true, force: true})
  }))
}

async function runWebpack(label: string, config: Configuration) {
  var webpack = (await import('webpack')).default
  return new Promise<Stats>(function(resolve, reject) {
    webpack(config, function(err, stats) {
      if (err) {
        reject(err)
        return
      }

      console.log('[' + label + ']', (stats as Stats).toString({
        colors: true
      }))
      resolve(stats as Stats)
    })
  })
}

// For production
async function webpackBuild() {
  var config = (await import('./webpack.config.mts')).webpack
  var stats = await runWebpack('webpack', config)

  // Save stats to a json file
  // Can be analyzed in http://webpack.github.io/analyse/
  fs.mkdirSync('./tmp', {recursive: true})
  fs.writeFileSync(path.join('./tmp', 'stats.json'), JSON.stringify(stats.toJson()))
}

async function webpackOthers() {
  var webpack = (await import('webpack')).default
  var config = Object.create((await import('./res/common/status/webpack.config.mts')).default)
  config.plugins = config.plugins.concat(
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production')
      }
    })
  )
  config.devtool = false

  await runWebpack('webpack-others', config)
}

async function translateExtract() {
  var GettextExtractor = (await import('gettext-extractor')).default.GettextExtractor
  var JsExtractors = (await import('gettext-extractor')).default.JsExtractors
  var extractor = new GettextExtractor()
  var singular = {arguments: {text: 0}}

  extractor
    .createJsParser([
      JsExtractors.callExpression(['t', 'gettext', 'translate'], singular)
    , JsExtractors.callExpression(['tn', 'translatePlural'], {
        arguments: {text: 1, textPlural: 2}
      })
    ])
    .parseFilesGlob('./res/app/src/**/*.@(ts|tsx)', {
      ignore: ['./res/app/src/**/*.test.@(ts|tsx)']
    })

  extractor.savePotFile('./res/common/lang/po/stf.pot')
}

async function translateCompile() {
  var gettextParser = await import('gettext-parser')

  var poDir = './res/common/lang/po'
  fs.readdirSync(poDir).filter(function(name) {
    return /\.po$/.test(name)
  }).forEach(function(name) {
    var file = path.join(poDir, name)
    var po = gettextParser.po.parse(fs.readFileSync(file))
    var language = po.headers.Language ||
      path.basename(file, '.po').replace(/^stf\./, '')
    var strings: Record<string, string | string[]> = {}

    Object.keys(po.translations).forEach(function(context) {
      Object.keys(po.translations[context]!).forEach(function(msgid) {
        var entry = po.translations[context]![msgid]!
        var translated = entry.msgstr.filter(Boolean)
        if (msgid && translated.length) {
          strings[msgid] = entry.msgid_plural ? entry.msgstr : entry.msgstr[0]!
        }
      })
    })

    var output: Record<string, typeof strings> = {}
    output[language] = strings
    fs.writeFileSync(
      path.join('./res/common/lang/translations', 'stf.' + language + '.json')
    , JSON.stringify(output)
    )
  })
}

async function translatePush() {
  console.log('Pushing translation source to Transifex...')
  await runCommand('tx', ['push', '-s'])
}

async function translatePull() {
  console.log('Pulling translations from Transifex...')
  await runCommand('tx', ['pull'])
}

var tasks: Record<string, Array<string | (() => Promise<void>)>> = {
  jsonlint: [jsonlint]
, eslint: [eslint]
, typecheck: ['wire-types', typecheck]
, 'wire-types': [wireTypes]
, compile: ['wire-types', compile]
, clean: [clean]
, webpack: [webpackBuild]
, 'webpack-others': [webpackOthers]
, checkversion: [checkversion]
, 'translate-extract': [translateExtract]
, 'translate-compile': [translateCompile]
, 'translate-push': [translatePush]
, 'translate-pull': [translatePull]
, translate: ['translate-extract', 'translate-push', 'translate-pull', 'translate-compile']
, build: ['compile', 'clean', 'webpack']
, lint: ['jsonlint', 'eslint', 'typecheck']
, test: ['compile', 'lint', 'checkversion']
}

async function runTask(name: string) {
  var started = Date.now()
  console.log('Starting \'' + name + '\'...')
  try {
    for (var step of tasks[name]!) {
      if (typeof step === 'string') {
        await runTask(step)
      }
      else {
        await step()
      }
    }
  }
  catch (error) {
    console.error('\'' + name + '\' failed after ' + (Date.now() - started) + ' ms')
    throw error
  }
  console.log('Finished \'' + name + '\' after ' + (Date.now() - started) + ' ms')
}

function printUsage() {
  console.error('Usage: node build.mts <task> [<task>...]')
  console.error('Tasks: ' + Object.keys(tasks).join(', '))
}

var requested = process.argv.slice(2)
var unknown = requested.filter(function(name) {
  return !Object.hasOwn(tasks, name)
})

if (requested.length === 0 || unknown.length > 0) {
  if (unknown.length > 0) {
    console.error('Unknown task: ' + unknown.join(', '))
  }
  printUsage()
  process.exitCode = 1
}
else {
  try {
    for (var name of requested) {
      await runTask(name)
    }
  }
  catch (error) {
    console.error('Build failed: ' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  }
}
