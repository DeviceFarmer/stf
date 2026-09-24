export function toggled<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set)
  if (next.has(key)) {
    next.delete(key)
  }
  else {
    next.add(key)
  }
  return next
}
