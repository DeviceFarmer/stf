import {memo, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type UIEvent} from 'react'
import {Badge} from '@mantine/core'
import {useTranslation} from '@/core/i18n'
import type {LogEntry} from './logcat'
import classes from './Logs.module.css'

const rowHeight = 22
const overscan = 20
const nativeColumns = '76px 92px 56px 56px minmax(72px, 180px) minmax(0, 1fr)'
const webColumns = '76px 92px minmax(0, 1fr)'

const priorityColors: Record<string, string> = {
  Verbose: 'gray'
  , Debug: 'blue'
  , Info: 'green'
  , Warn: 'yellow'
  , Error: 'red'
  , Fatal: 'red'
}

function cellClass(...names: Array<string | undefined>): string {
  return [classes.cell, ...names].join(' ')
}

const LogRow = memo(function LogRow({entry, native}: {entry: LogEntry, native: boolean}) {
  return (
    <div className={`${classes.row} log-${entry.priorityLabel}`} data-priority={entry.priorityLabel}>
      <span className={classes.cell}>
        <Badge
          size='xs'
          radius='sm'
          fullWidth
          variant={entry.priorityLabel === 'Fatal' ? 'filled' : 'light'}
          color={priorityColors[entry.priorityLabel] || 'gray'}
        >
          {entry.priorityLabel}
        </Badge>
      </span>
      <span className={cellClass(classes.dim)}>{entry.dateLabel}</span>
      {native && (
        <>
          <span className={cellClass(classes.dim, classes.number)}>{entry.pid}</span>
          <span className={cellClass(classes.dim, classes.number)}>{entry.tid}</span>
          <span className={cellClass(classes.tag)} title={entry.tag}>{entry.tag}</span>
        </>
      )}
      <span className={cellClass(classes.message)} title={entry.message}>{entry.message}</span>
    </div>
  )
})

function findEntryIndex(entries: LogEntry[], id: number): number {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (entries[middle]!.id < id) {
      low = middle + 1
    }
    else {
      high = middle
    }
  }
  return low
}

export function LogTable({entries, native, follow, onFollowChange, empty}: {
  entries: LogEntry[]
  native: boolean
  follow: boolean
  onFollowChange: (follow: boolean) => void
  empty: ReactNode
}) {
  const {t} = useTranslation()
  const viewportRef = useRef<HTMLDivElement>(null)
  const latest = useRef({entries, follow, onFollowChange})
  const anchor = useRef<{id: number, offset: number} | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)

  latest.current = {entries, follow, onFollowChange}

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return undefined
    }
    const observer = new ResizeObserver(() => setHeight(viewport.clientHeight))
    observer.observe(viewport)
    setHeight(viewport.clientHeight)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    if (follow) {
      viewport.scrollTop = viewport.scrollHeight
    }
    else if (anchor.current) {
      const target = findEntryIndex(entries, anchor.current.id) * rowHeight + anchor.current.offset
      if (Math.abs(viewport.scrollTop - target) >= 1) {
        viewport.scrollTop = target
      }
    }
    setScrollTop(viewport.scrollTop)
  }, [entries, follow, height])

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget
    const top = viewport.scrollTop
    const index = Math.floor(top / rowHeight)
    const current = latest.current
    const entry = current.entries[index]
    anchor.current = entry ? {id: entry.id, offset: top - index * rowHeight} : null
    setScrollTop(top)
    const atBottom = viewport.scrollHeight - top - viewport.clientHeight < rowHeight / 2
    if (atBottom !== current.follow) {
      current.onFollowChange(atBottom)
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(entries.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)
  const style = {'--log-columns': native ? nativeColumns : webColumns, '--log-row-height': `${rowHeight}px`}

  return (
    <div className={`${classes.table} stf-logcat-table`} style={style as CSSProperties}>
      <div className={`${classes.viewport} console-message-text selectable`} ref={viewportRef} onScroll={onScroll}>
        <div className={classes.header}>
          <span className={classes.cell}>{t('Level')}</span>
          <span className={classes.cell}>{t('Time')}</span>
          {native && (
            <>
              <span className={cellClass(classes.number)}>{t('PID')}</span>
              <span className={cellClass(classes.number)}>{t('TID')}</span>
              <span className={classes.cell}>{t('Tag')}</span>
            </>
          )}
          <span className={classes.cell}>{t('Text')}</span>
        </div>
        <div className={classes.sizer} style={{height: entries.length * rowHeight}}>
          <div style={{transform: `translateY(${start * rowHeight}px)`}}>
            {entries.slice(start, end).map((entry) => (
              <LogRow key={entry.id} entry={entry} native={native} />
            ))}
          </div>
        </div>
      </div>
      {entries.length === 0 && <div className={classes.empty}>{empty}</div>}
    </div>
  )
}
