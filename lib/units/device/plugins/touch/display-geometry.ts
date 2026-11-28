export interface NaturalDisplaySize {
  readonly width: number
  readonly height: number
}

/** Legacy touch backends are bound to the primary display and its starting axes. */
export function requiresDisplayInput(
  target: NaturalDisplaySize, primary: NaturalDisplaySize
): boolean {
  return target.width !== primary.width || target.height !== primary.height
}
