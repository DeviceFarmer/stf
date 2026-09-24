import {useEffect, useState} from 'react'
import {addItem, addItems, removeItem, updateItem, type Collection} from '@/core/collection'
import {onSocket} from '@/core/socket'

export interface LiveCollectionSource<T> {
  load: () => Promise<T[]>
  keyOf: (item: T) => string
  itemOf: (message: any) => T
  events: {created: string, deleted: string, updated: readonly string[]}
}

export function useLiveCollection<T>(source: LiveCollectionSource<T>) {
  const [collection, setCollection] = useState<Collection<T>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    const {load, keyOf, itemOf, events} = source
    let cancelled = false
    load()
      .then((items) => {
        if (!cancelled) {
          setCollection((current) => addItems(current, items, keyOf, -1))
          setLoading(false)
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason)
          setLoading(false)
        }
      })
    const unsubscribers = [
      onSocket(events.created, (message) => {
        const item = itemOf(message)
        setCollection((current) => addItem(current, keyOf(item), item, message.timeStamp).collection)
      })
      , onSocket(events.deleted, (message) => {
        const key = keyOf(itemOf(message))
        setCollection((current) => removeItem(current, key, message.timeStamp).collection)
      })
      , ...events.updated.map((event) => onSocket(event, (message) => {
        const item = itemOf(message)
        setCollection((current) => updateItem(current, keyOf(item), item, message.timeStamp).collection)
      }))
    ]
    return () => {
      cancelled = true
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [source])

  return {collection, loading, error}
}
