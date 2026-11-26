export interface AndroidDisplayTarget {
  readonly id: number
  readonly width: number
  readonly height: number
  readonly rotation: number
  readonly revision: string
}

export type FoldablePostureMode = 'folded' | 'unfolded' | 'sensor'
