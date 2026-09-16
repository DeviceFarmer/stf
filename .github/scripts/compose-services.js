var assert = require('assert/strict')
var fs = require('fs')

var units = {
  migrate: 'migrate'
, 'triproxy-app': 'triproxy'
, 'triproxy-dev': 'triproxy'
, processor: 'processor'
, reaper: 'reaper'
, 'groups-engine': 'groups-engine'
, auth: 'auth-mock'
, app: 'app'
, api: 'api'
, websocket: 'websocket'
, storage: 'storage-temp'
, 'storage-image': 'storage-plugin-image'
, 'storage-apk': 'storage-plugin-apk'
, provider: 'provider'
}

var containers = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
var expected = Object.keys(units).concat(['rethinkdb', 'adb', 'proxy']).sort()
var services = containers.map(function(container) {
  return container.Config.Labels['com.docker.compose.service']
}).sort()
assert.deepEqual(services, expected, 'every unit must have its own container')

containers.forEach(function(container) {
  var name = container.Config.Labels['com.docker.compose.service']
  assert.equal(container.RestartCount, 0, name + ' restarted')
  if (units[name]) {
    assert.deepEqual(container.Config.Cmd.slice(0, 2), ['stf', units[name]],
      name + ' must run its unit directly')
    assert.equal(container.Config.Image, process.env.STF_IMAGE,
      name + ' must use the image built from this checkout')
  }
  if (name === 'migrate') {
    assert.equal(container.State.Status, 'exited', 'migration must finish')
    assert.equal(container.State.ExitCode, 0, 'migration must succeed')
  }
  else {
    assert.equal(container.State.Status, 'running', name + ' must remain running')
    if (container.State.Health) {
      assert.equal(container.State.Health.Status, 'healthy', name + ' must be healthy')
    }
  }
})

console.log('16 services running without restarts; database migration completed')
