import {describe, expect, it} from 'vitest'
import {scalingCoordinator} from './scaling'

describe('scalingCoordinator', () => {
  const scaler = scalingCoordinator(1080, 1920)

  it('maps a point in an unrotated letterboxed area to device percentages', () => {
    expect(scaler.coords(1080, 1920, 540, 960, 0)).toEqual({xP: 0.5, yP: 0.5})
    expect(scaler.coords(2000, 1920, 1000, 0, 0)).toEqual({xP: 0.5, yP: 0})
  })

  it('swaps axes for rotated displays', () => {
    const point = scaler.coords(1920, 1080, 0, 0, 90)
    expect(point.xP).toBeCloseTo(1)
    expect(point.yP).toBeCloseTo(0)
  })

  it('clamps points outside the rendered area to its edges', () => {
    expect(scaler.coords(1080, 1920, -50, 3000, 0)).toEqual({xP: 0, yP: 1})
  })

  it('never scales above the real size and keeps the ratio', () => {
    expect(scaler.size(4000, 4000)).toEqual({width: 1080, height: 1920})
    expect(scaler.size(540, 4000)).toEqual({width: 540, height: 960})
    expect(scaler.projectedSize(1000, 1000, 90)).toEqual({width: 562, height: 1000})
    expect(scaler.projectedSize(1000, 1000, 0)).toEqual({width: 562, height: 1000})
  })
})
