import {useMemo, useState} from 'react'
import sortBy from 'lodash/sortBy'
import {getItem, listOf} from '@/core/collection'
import {searchFilter} from '@/ui/paging'
import {GroupDetail, type GroupTab} from './GroupDetail'
import {GroupList} from './GroupList'
import {useGroupsSettingsSync, useGroupsStore} from './store'
import classes from './GroupsSettings.module.css'

export default function GroupsSettings() {
  useGroupsSettingsSync()
  const collection = useGroupsStore((state) => state.groups)
  const groups = useMemo(() => sortBy(listOf(collection), (group) => group.name.toLowerCase()), [collection])
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => searchFilter(groups, search), [groups, search])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<GroupTab>('devices')
  const [confirmRemove, setConfirmRemove] = useState(true)
  const explicit = selectedId ? getItem(collection, selectedId) : undefined
  const selected = explicit && filtered.includes(explicit) ? explicit : filtered[0]

  return (
    <div className={`stf-groups ${classes.root}`}>
      <div className={classes.layout}>
        <GroupList
          groups={groups}
          filtered={filtered}
          search={search}
          onSearchChange={setSearch}
          selectedId={selected?.id || null}
          onSelect={setSelectedId}
          confirmRemove={confirmRemove}
          onConfirmRemoveChange={setConfirmRemove}
        />
        {selected && (
          <GroupDetail group={selected} tab={tab} onTabChange={setTab} confirmRemove={confirmRemove} />
        )}
      </div>
    </div>
  )
}
