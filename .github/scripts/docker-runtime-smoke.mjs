#!/usr/bin/env node

// Run in the final image as its default user, with no network or devices.
import assert from 'node:assert/strict'
import {execFile, spawn} from 'node:child_process'
import fs from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {parseArgs, promisify} from 'node:util'

const {values} = parseArgs({options: {
  'app-root': {type: 'string', default: '/app'},
  aab: {type: 'string'}
}})
const root = path.resolve(values['app-root'])
const require = createRequire(path.join(root, 'package.json'))
const execute = promisify(execFile)
const checks = []
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'stf-runtime-'))
const environment = {...process.env}
delete environment.ALLOW_OUTDATED_DEPENDENCIES

async function check(name, action) {
  try {
    const details = await action()
    checks.push({name, status: 'passed', details})
  }
  catch (error) {
    checks.push({name, status: 'failed', error: error.stack || String(error)})
  }
  console.error(name + ': ' + checks.at(-1).status)
}

function command(file, args) {
  return execute(file, args, {cwd: root, env: environment,
    timeout: 30000, maxBuffer: 4 * 1024 * 1024})
}

async function requiredFile(relative) {
  const file = path.join(root, relative)
  assert((await fs.stat(file)).isFile(), 'Missing file: ' + relative)
  assert((await fs.stat(file)).size > 0, 'Empty file: ' + relative)
}

// The existing converter starts Java; isolate it so a timeout kills both processes.
function convertAab(fixture) {
  const source = `
    const fs = require('node:fs')
    const path = require('node:path')
    const cp = require('node:child_process')
    const spawn = cp.spawn
    cp.spawn = function(file, ...args) {
      const child = spawn.call(this, file, ...args)
      if (file === 'java') child.stderr.on('data', data => process.stderr.write(data))
      return child
    }
    const req = require('node:module').createRequire(path.join(process.argv[1], 'package.json'))
    const file = {path: path.join(process.argv[2], 'sample.aab'), isAab: true}
    fs.copyFileSync(process.argv[3], file.path)
    req('./lib/util/bundletool.js').default({
      bundletoolPath: path.join(process.argv[1], 'bundletool/bundletool.jar'), file,
      keystore: {ksPath: path.join(process.argv[2], 'test.keystore'), ksKeyAlias: 'smoke',
        ksPass: 'smoke-test', ksKeyPass: 'smoke-test', ksKeyalg: 'RSA', ksValidity: 1,
        ksKeysize: 2048, ksDname: 'CN=STF runtime smoke,OU=Test,O=Test,L=Test,C=US'}
    }).then(async result => {
      const reader = await req('@devicefarmer/adbkit-apkreader').open(result.path)
      const manifest = await reader.readManifest()
      if (!manifest.package) throw new Error('Converted APK has no package')
      console.log('STF_AAB_RESULT=' + JSON.stringify({package: manifest.package}))
    }).catch(error => {console.error(error.stack || error); process.exitCode = 1})
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source, root, temporary, fixture], {
      cwd: root, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      try { process.kill(-child.pid, 'SIGKILL') }
      catch (error) { if (error.code !== 'ESRCH') reject(error) }
    }, 180000)
    child.stdout.on('data', chunk => {stdout += chunk})
    child.stderr.on('data', chunk => {stderr += chunk})
    child.once('error', error => {clearTimeout(timer); reject(error)})
    child.once('close', code => {
      clearTimeout(timer)
      const result = stdout.split('\n').find(line => line.startsWith('STF_AAB_RESULT='))
      if (expired || code !== 0 || !result) {
        reject(new Error('AAB conversion ' + (expired ? 'timed out' : 'failed') + '\n' + stderr + stdout))
        return
      }
      resolve(JSON.parse(result.slice('STF_AAB_RESULT='.length)))
    })
  })
}

try {
  await check('runtime-user', () => {
    assert.equal(process.platform, 'linux')
    const expected = process.arch === 'x64' ? 998 : 999
    assert.equal(process.getuid(), expected)
    assert.equal(process.getgid(), expected)
    return {uid: process.getuid(), gid: process.getgid(), arch: process.arch}
  })

  await check('cli-and-dependencies', async () => {
    assert.deepEqual(require('./lib/util/depcheck.js').findProblems(root), [])
    const manifest = require('./package.json')
    const version = await command(path.join(root, 'bin/stf'), ['--version'])
    assert.equal(version.stdout.trim(), manifest.version)
    const help = await command(path.join(root, 'bin/stf'), ['--help'])
    assert.match(help.stdout, /ios-provider/)
    assert.match(help.stdout, /storage-plugin-image/)
    return {version: manifest.version}
  })

  await check('packaged-assets', async () => {
    for (const file of ['LICENSE', 'res/build/entry/app.entry.js',
      'res/build/entry/authmock.entry.js', 'res/build/entry/authldap.entry.js',
      'res/common/logo/exports/STF-128.png', 'lib/wire/wire.proto',
      'tools/ios-prototype/main.mts']) await requiredFile(file)
    return {license: true, frontend: true, ios: true}
  })

  await check('native-jpeg', () => {
    const jpeg = require('@julusian/jpeg-turbo')
    const pixels = Buffer.alloc(8 * 8 * 4, 255)
    const encoded = jpeg.compressSync(pixels, {format: jpeg.FORMAT_RGBA,
      width: 8, height: 8, quality: 95, subsampling: jpeg.SAMP_444})
    const decoded = jpeg.decompressSync(encoded, {format: jpeg.FORMAT_RGBA})
    assert.equal(decoded.width, 8)
    assert.equal(decoded.height, 8)
    assert.equal(decoded.data.length, pixels.length)
    assert(Math.abs(decoded.data[0] - 255) <= 2)
    return {encodedBytes: encoded.length}
  })

  await check('native-websocket-addons', () => {
    const details = {}
    for (const name of ['bufferutil', 'utf-8-validate']) {
      const entry = require.resolve(name)
      const native = createRequire(entry)('node-gyp-build')(path.dirname(entry))
      const publicApi = require(name)
      if (name === 'bufferutil') {
        assert.equal(publicApi.mask, native.mask, 'Unexpected JavaScript fallback')
        const input = Buffer.from('STF WebSocket')
        const mask = Buffer.from([1, 3, 7, 15])
        const output = Buffer.alloc(input.length)
        native.mask(input, mask, output, 0, input.length)
        assert.notDeepEqual(output, input)
        native.unmask(output, mask)
        assert.deepEqual(output, input)
      }
      else {
        assert.equal(publicApi, native, 'Unexpected JavaScript fallback')
        assert.equal(native(Buffer.from('STF \u041f\u0440\u0438\u0432\u0435\u0442')), true)
        assert.equal(native(Buffer.from([0xc0, 0xaf])), false)
      }
      details[name] = 'native'
    }
    return details
  })

  await check('graphicsmagick', async () => {
    const input = path.join(root, 'res/common/logo/exports/STF-128.png')
    const output = path.join(temporary, 'resized.png')
    await command('gm', ['convert', input, '-geometry', '16x16^', '-crop', '16x16+0+0', output])
    const png = await fs.readFile(output)
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    assert.equal(png.readUInt32BE(16), 16)
    assert.equal(png.readUInt32BE(20), 16)
    return {width: 16, height: 16}
  })

  await check('android-payloads-and-apk', async () => {
    const prefix = 'node_modules/@devicefarmer/'
    const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']
    for (const name of ['minicap', 'minitouch', 'minirev']) {
      for (const abi of abis) {
        const directory = prefix + name + '-prebuilt/prebuilt/' + abi + '/bin/'
        await requiredFile(directory + name)
        await requiredFile(directory + name + '-nopie')
      }
    }
    await requiredFile(prefix + 'minicap-prebuilt/prebuilt/noarch/minicap.apk')
    await requiredFile(prefix + 'stfservice-prebuilt/prebuilt/noarch/wire.proto')
    const apk = path.join(root, prefix + 'stfservice-prebuilt/prebuilt/noarch/STFService.apk')
    const reader = await require('@devicefarmer/adbkit-apkreader').open(apk)
    const manifest = await reader.readManifest()
    assert.equal(manifest.package, 'jp.co.cyberagent.stf')
    return {abis, package: manifest.package}
  })

  await check('java-and-bundletool', async () => {
    const java = await command('java', ['-version'])
    await command('keytool', ['-help'])
    const tool = await command('java', ['-jar', path.join(root, 'bundletool/bundletool.jar'), 'version'])
    assert.match(java.stderr + java.stdout, /version/)
    assert.equal(tool.stdout.trim(), '1.2.0')
    return {java: (java.stderr + java.stdout).split('\n')[0], bundletool: tool.stdout.trim()}
  })

  if (values.aab) {
    await check('aab-conversion', () => convertAab(path.resolve(values.aab)))
  }
  else if (process.arch === 'arm64') {
    const reason = 'Bundletool 1.2.0 embeds Linux aapt2 for x86_64; native ARM64 AAB conversion is not supported.'
    console.error('aab-conversion: skipped; ' + reason)
    checks.push({name: 'aab-conversion', status: 'skipped', reason})
  }
  else {
    await check('aab-conversion', () => {throw new Error('An amd64 runtime check requires --aab PATH')})
  }

  // A ZeroMQ context starts native threads; keep subprocess probes before it.
  await check('zeromq-message', async () => {
    const zmq = require('zeromq')
    const receiver = new zmq.Pair({receiveTimeout: 10000})
    const sender = new zmq.Pair({sendTimeout: 10000})
    try {
      const address = 'inproc://stf-runtime-' + process.pid
      await receiver.bind(address)
      sender.connect(address)
      await sender.send('STF runtime')
      const [message] = await receiver.receive()
      assert.equal(message.toString(), 'STF runtime')
      return {version: zmq.version}
    }
    finally {sender.close(); receiver.close()}
  })
}
finally {
  await fs.rm(temporary, {recursive: true, force: true})
}

const failed = checks.some(item => item.status === 'failed')
console.log(JSON.stringify({status: failed ? 'failed' : 'passed',
  node: process.version, arch: process.arch, checks}, null, 2))
process.exitCode = failed ? 1 : 0
