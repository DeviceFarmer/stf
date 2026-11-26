import assert from 'node:assert/strict'
import {AndroidDisplayRegistry, parsePrimaryDisplay} from
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

  it('probes after an in-flight sample taken before a posture change', async() => {
    let resolve!: (geometry: typeof primary) => void
    let probeCount = 0
    const display = new AndroidDisplayRegistry(primaryProperties(), () => {
      probeCount += 1
      if (probeCount === 1) {
        return new Promise(done => {
          resolve = done
        })
      }
      return Promise.resolve({...primary, width: 904, height: 2316})
    })

    const before = display.refresh()
    await Promise.resolve()
    const after = display.refreshAfterTransition()
    resolve(primary)
    await before
    await after
    assert.equal(probeCount, 2)
    assert.equal(display.target.width, 904)
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
