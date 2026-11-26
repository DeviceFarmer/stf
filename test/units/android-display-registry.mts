import assert from 'node:assert/strict'
import {AndroidDisplayRegistry, parsePrimaryDisplay, parsePrimaryDisplayLayout} from
  '../../lib/units/device/plugins/util/display.js'

const primary = {id: 0, width: 1080, height: 2400, rotation: 0}

function primaryProperties() {
  return {...primary, xdpi: 400, ydpi: 400, density: 2.5, fps: 60, secure: true, url: 'ws://localhost:7100'}
}

function displayLine(id: number, name: string, type: string, rotation = 0) {
  return `Display id ${id}: DisplayInfo{"${name}", displayId ${id}, real 800 x 600, ` +
    `app 700 x 500, rotation ${rotation}, state ON, type ${type}, ` +
    `uniqueId "${id}", layerStack ${id}}, DisplayMetrics{width=800, height=600}, isValid=true`
}

describe('Android display registry', function() {
  it('uses the natural geometry of the primary built-in display', function() {
    const overlays = [
      'Displays:'
      , displayLine(7, 'Inactive panel', 'INTERNAL')
      , displayLine(2, 'Overlay #1', 'OVERLAY', 3)
      , displayLine(3, 'minicap', 'VIRTUAL')
      , displayLine(4, 'Monitor', 'EXTERNAL')
    ]
    const builtIn = displayLine(0, 'Built-in Screen', 'INTERNAL', 1)

    assert.deepEqual(parsePrimaryDisplay([...overlays, builtIn].join('\n')), {
      id: 0, width: 600, height: 800, rotation: 90, uniqueId: '0'
    })
    assert.equal(parsePrimaryDisplay(overlays.join('\n')), null)
    assert.equal(parsePrimaryDisplay(builtIn.replace('isValid=true', 'isValid=false')), null)
    assert.equal(parsePrimaryDisplay(builtIn.replace('state ON', 'state OFF')), null)
    const unsettled = builtIn.replace('state ON', 'state ON, committedState OFF')
    assert.equal(parsePrimaryDisplay(unsettled), null)
  })

  it('reads dozing display geometry only with an explicit opt-in', function() {
    const line = displayLine(0, 'Built-in Screen', 'INTERNAL')
    const doze = line.replace('state ON', 'state DOZE, committedState DOZE')
    const suspend = line.replace('state ON', 'state DOZE_SUSPEND, committedState UNKNOWN')

    assert.equal(parsePrimaryDisplay(doze), null)
    assert.deepEqual(parsePrimaryDisplay(doze, true)?.doze, {
      state: 'DOZE', committed: 'DOZE'
    })
    assert.deepEqual(parsePrimaryDisplay(suspend, true)?.doze, {
      state: 'DOZE_SUSPEND', committed: 'UNKNOWN'
    })
    assert.equal(parsePrimaryDisplay(doze.replace('committedState DOZE', 'committedState ON'),
      true), null)
  })

  it('uses the enabled primary panel address declared by Android for a state', function() {
    const dump = [
      'DeviceStateToLayoutMap:'
      , '  state(7): [{dispId: 0(ON), displayGroupName: , addr: {port=12, model=0xaa}}, ' +
        '{dispId: 1(ON), addr: {port=14}}]'
      , '  state(19): [{dispId: 0(OFF), addr: {port=12}}, {dispId: 1(ON), addr: {port=14}}]'
    ].join('\n')
    assert.deepEqual(parsePrimaryDisplayLayout(dump, 7), {port: 12, model: '0xaa'})
    assert.equal(parsePrimaryDisplayLayout(dump, 19), null)
    assert.equal(parsePrimaryDisplayLayout(dump, 9), null)
    assert.equal(parsePrimaryDisplayLayout(dump + '\n' + dump, 7), null)
  })

  it('waits for the mapped panel when its predecessor has the same size', async() => {
    const first = displayLine(0, 'First physical panel', 'INTERNAL')
      .replace('layerStack 0', 'address {port=12, model=0xaa}, layerStack 0')
    const next = first.replace('port=12', 'port=14').replace('model=0xaa', 'model=0xbb')
    const samples = [first, first, first, next, next]
    const display = new AndroidDisplayRegistry(primaryProperties(), async() =>
      parsePrimaryDisplay(samples.shift() ?? ''), async state => {
      assert.equal(state, 19)
      return {port: 14, model: '0xbb'}
    })
    await display.refresh()
    const old = display.target

    display.beginTransition()
    const active = await display.refreshAfterPosture(19, false, true)
    display.endTransition()

    assert.equal(samples.length, 0)
    assert.equal(active.width, old.width)
    assert.equal(active.height, old.height)
    assert.notEqual(active.revision, old.revision)
  })

  it('waits for a physical change when the target layout is unavailable', async() => {
    const samePanel = {...primary, uniqueId: 'inside', address: {port: 12}}
    const rotated = {...samePanel, rotation: 90}
    const cover = {...rotated, width: 904, height: 2316}
    const samples = [samePanel, samePanel, rotated, rotated, cover, cover]
    const display = new AndroidDisplayRegistry(
      primaryProperties(), async() => samples.shift() ?? null, async() => null
    )
    const original = display.target

    display.beginTransition()
    const ready = await display.refreshAfterPosture(19, false, true)
    display.endTransition()

    assert.equal(samples.length, 0)
    assert.equal(ready.width, cover.width)
    assert.equal(ready.height, cover.height)
    assert.notEqual(ready.revision, original.revision)
  })

  it('accepts a different physical address without a change in panel size', async() => {
    const inner = {...primary, uniqueId: 'internal', address: {port: 12}}
    const outer = {...inner, address: {port: 14}}
    const samples = [inner, inner, inner, outer, outer]
    const display = new AndroidDisplayRegistry(
      primaryProperties(), async() => samples.shift() ?? null
    )
    await display.refresh()
    const original = display.target

    display.beginTransition()
    const ready = await display.refreshAfterPosture(19, false, true)
    display.endTransition()

    assert.equal(samples.length, 0)
    assert.equal(ready.width, original.width)
    assert.equal(ready.height, original.height)
    assert.notEqual(ready.revision, original.revision)
  })

  it('updates the stream when the active panel or its geometry changes', async() => {
    let geometry = {...primary, width: 1768, height: 2208, uniqueId: 'inside'}
    const display = new AndroidDisplayRegistry(primaryProperties(), async() => geometry)
    const original = display.target
    const revisions: string[] = []
    const rotations: number[] = []
    display.on('change', target => revisions.push(target.revision))
    display.on('rotationChange', rotation => rotations.push(rotation))

    await display.refresh()
    const firstRevision = display.target.revision
    assert.notEqual(firstRevision, original.revision)
    assert.equal(display.target.width, 1768)
    assert.equal(display.properties.width, 1768)

    await display.refresh()
    assert.deepEqual(revisions, [firstRevision])

    geometry = {...geometry, uniqueId: 'outside'}
    await display.refresh()
    const secondRevision = display.target.revision
    assert.notEqual(secondRevision, firstRevision)

    display.invalidate()
    assert.notEqual(display.target.revision, secondRevision)
    assert.deepEqual(revisions, [firstRevision, secondRevision, display.target.revision])
    assert.deepEqual(rotations, [])
  })

  it('deduplicates probes and keeps a newer primary rotation event', async() => {
    let resolve!: (geometry: typeof primary) => void
    let probeCount = 0
    const display = new AndroidDisplayRegistry(primaryProperties(), () => {
      probeCount += 1
      return new Promise(done => {
        resolve = done
      })
    })
    const first = display.refresh()
    assert.equal(display.refresh(), first)
    await Promise.resolve()
    assert.equal(probeCount, 1)
    display.updateRotation(90)
    resolve(primary)
    await first
    assert.equal(display.properties.rotation, 90)
    assert.equal(display.target.rotation, 90)
  })

  it('waits for two active samples and ignores an in-flight probe and rotation', async() => {
    let resolve!: (geometry: typeof primary) => void
    let probeCount = 0
    const cover = {...primary, width: 904, height: 2316}
    const samples = [primary, cover, {...cover, width: 900}, cover, cover]
    const display = new AndroidDisplayRegistry(primaryProperties(), () => {
      probeCount += 1
      if (probeCount === 1) {
        return new Promise(done => {
          resolve = done
        })
      }
      return Promise.resolve(samples.shift() ?? null)
    })

    const before = display.refresh()
    await Promise.resolve()
    const original = display.target
    const revisions: string[] = []
    display.on('change', target => revisions.push(target.revision))
    display.beginTransition()
    assert.equal(display.isTransitioning, true)
    await display.refresh()
    display.updateRotation(90)
    const after = display.refreshAfterTransition(geometry => geometry.width === cover.width)
    resolve({...primary, rotation: 270})
    await before
    assert.equal(display.target, original)
    const ready = await after
    display.endTransition()
    assert.equal(display.isTransitioning, false)
    assert.equal(probeCount, 6)
    assert.equal(display.target, ready)
    assert.equal(display.target.width, 904)
    assert.equal(display.target.rotation, 0)
    assert.deepEqual(revisions, [ready.revision])
  })

  it('preserves the ready frame revision when returning to the same panel', async() => {
    const display = new AndroidDisplayRegistry(primaryProperties(), async() => primary)
    const original = display.target
    display.beginTransition()
    const ready = await display.refreshAfterPosture(19, true, false)
    display.endTransition()
    assert.equal(ready, original)
    assert.equal(display.target, original)
  })

  it('requires two matching doze samples from the same panel after Follow hinge', async() => {
    const inner = displayLine(0, 'Built-in Screen', 'INTERNAL')
      .replace('800 x 600', '1812 x 2176')
    const changedPanel = inner.replace('uniqueId "0"', 'uniqueId "1"')
    const doze = inner.replace('state ON', 'state DOZE, committedState DOZE')
    const changedDoze = changedPanel.replace('state ON', 'state DOZE, committedState DOZE')
    const unknown = doze.replace('committedState DOZE', 'committedState UNKNOWN')
    const samples = [inner, changedDoze, changedDoze, unknown, doze, doze]
    const display = new AndroidDisplayRegistry(primaryProperties(), async(_signal, allowDoze) =>
      parsePrimaryDisplay(samples.shift() ?? '', allowDoze))

    await display.refresh()
    const original = display.target
    display.beginTransition()
    const ready = await display.refreshAfterTransition(geometry => geometry.width === 1812, true)
    display.endTransition()

    assert.equal(samples.length, 0)
    assert.equal(ready, original)
    assert.equal(display.target, original)
  })

  it('keeps waiting for an active sample on forced foldable posture changes', async() => {
    const inner = displayLine(0, 'Built-in Screen', 'INTERNAL')
    const doze = inner.replace('state ON', 'state DOZE, committedState DOZE')
    const samples = [inner, doze, doze, inner, inner]
    const display = new AndroidDisplayRegistry(primaryProperties(), async() =>
      parsePrimaryDisplay(samples.shift() ?? '', true))
    await display.refresh()

    display.beginTransition()
    await display.refreshAfterTransition()
    display.endTransition()

    assert.equal(samples.length, 0)
  })

  it('keeps the previous stream geometry when discovery fails', async() => {
    const display = new AndroidDisplayRegistry(primaryProperties(), async() => {
      throw new Error('Display discovery unavailable')
    })
    const original = display.target

    await display.refresh()
    assert.equal(display.target, original)
  })
})
