import mergeWith from 'lodash/mergeWith'

export interface CollectionEntry<T> {
  value: T | null
  timeStamp: number
}

export type Collection<T> = Readonly<Record<string, CollectionEntry<T>>>

export interface CollectionChange<T> {
  collection: Collection<T>
  item: T | null
}

function overwriteArrays(_a: unknown, b: unknown): unknown {
  return Array.isArray(b) ? b : undefined
}

export function mergeObject<T>(target: T, source: unknown): T {
  return mergeWith({}, target, source, overwriteArrays)
}

function isAddable(entry: CollectionEntry<unknown> | undefined, timeStamp: number): boolean {
  return !entry || timeStamp >= entry.timeStamp && entry.value === null
}

export function getItem<T>(collection: Collection<T>, key: string): T | undefined {
  return collection[key]?.value ?? undefined
}

export function hasItem<T>(collection: Collection<T>, key: string): boolean {
  return Boolean(collection[key]?.value)
}

export function listOf<T>(collection: Collection<T>): T[] {
  const list: T[] = []
  for (const entry of Object.values(collection)) {
    if (entry.value !== null) {
      list.push(entry.value)
    }
  }
  return list
}

export function addItem<T>(
  collection: Collection<T>
, key: string
, value: T
, timeStamp: number
): CollectionChange<T> {
  if (!isAddable(collection[key], timeStamp)) {
    return {collection, item: null}
  }
  return {collection: {...collection, [key]: {value, timeStamp}}, item: value}
}

export function addItems<T>(
  collection: Collection<T>
, values: T[]
, keyOf: (value: T) => string
, timeStamp: number
): Collection<T> {
  const next: Record<string, CollectionEntry<T>> = {...collection}
  for (const value of values) {
    const key = keyOf(value)
    if (isAddable(next[key], timeStamp)) {
      next[key] = {value, timeStamp}
    }
  }
  return next
}

export function updateItem<T>(
  collection: Collection<T>
, key: string
, value: T
, timeStamp: number
, noAdding = false
): CollectionChange<T> {
  const current = collection[key]?.value
  if (current) {
    const merged = mergeObject(current, value)
    return {collection: {...collection, [key]: {value: merged, timeStamp}}, item: merged}
  }
  if (!noAdding) {
    return addItem(collection, key, value, timeStamp)
  }
  return {collection, item: null}
}

export function removeItem<T>(
  collection: Collection<T>
, key: string
, timeStamp: number
): CollectionChange<T> {
  const entry = collection[key]
  if (entry && entry.value !== null && timeStamp >= entry.timeStamp) {
    return {collection: {...collection, [key]: {value: null, timeStamp}}, item: entry.value}
  }
  if (!entry) {
    return {collection: {...collection, [key]: {value: null, timeStamp}}, item: null}
  }
  return {collection, item: null}
}
