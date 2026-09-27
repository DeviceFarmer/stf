const mapping: Record<number, Record<number, number>> = {
  '0': {'0': 0, '90': -90, '180': -180, '270': 90}
  , '90': {'0': 90, '90': 0, '180': -90, '270': 180}
  , '180': {'0': 180, '90': 90, '180': 0, '270': -90}
  , '270': {'0': -90, '90': -180, '180': 90, '270': 0}
}

function normalize(rotation: number): number {
  const quarter = Math.round(rotation / 90) * 90 % 360
  return quarter < 0 ? 360 + quarter : quarter
}

export function rotator(oldRotation: number, newRotation: number): number {
  return mapping[normalize(oldRotation)]?.[normalize(newRotation)] ?? 0
}
