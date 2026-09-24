import {IconChevronDown, IconChevronUp, IconSelector} from '@tabler/icons-react'
import type {ColumnSort} from './table-model'
import classes from './SortIcon.module.css'

export function SortIcon({sort}: {sort: ColumnSort}) {
  if (sort === 'sort-asc') {
    return <IconChevronUp size={14} />
  }
  if (sort === 'sort-desc') {
    return <IconChevronDown size={14} />
  }
  return <IconSelector size={14} className={classes.idle} />
}
