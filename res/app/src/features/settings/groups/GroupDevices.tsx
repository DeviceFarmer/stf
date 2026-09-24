import {useEffect, useMemo, useState} from 'react'
import {ActionIcon, Badge, Button, Center, Loader, Tabs, Tooltip} from '@mantine/core'
import {IconDeviceMobile, IconPlus, IconTrash} from '@tabler/icons-react'
import {getItem, listOf, type Collection} from '@/core/collection'
import type {Group as StfGroup} from '@/core/groups-api'
import {gettext, useTranslation} from '@/core/i18n'
import {tableDataDefaults} from '@/ui/table-model'
import {addGroupDevice, addGroupDevices, removeGroupDevice, removeGroupDevices} from './actions'
import {canAddDevices, isOriginGroup, networkOf, screenArea, screenOf} from './rules'
import {ObjectsTable, type ObjectsColumn} from './shared/ObjectsTable'
import {useGroupsStore, watchTransientDevices} from './store'
import type {SettingsDevice} from './types'

const deviceColumns: ObjectsColumn<SettingsDevice>[] = [
  {name: gettext('Model'), render: (device) => device.model, sortValue: (device) => device.model}
  , {name: gettext('Serial'), render: (device) => device.serial, sortValue: (device) => device.serial}
  , {name: gettext('Carrier'), render: (device) => device.operator, sortValue: (device) => device.operator}
  , {name: gettext('OS'), render: (device) => device.version, sortValue: (device) => device.version}
  , {name: gettext('Network'), render: networkOf, sortValue: networkOf}
  , {name: gettext('Screen'), render: screenOf, sortValue: screenArea}
  , {
    name: gettext('Manufacturer')
    , render: (device) => device.manufacturer
    , sortValue: (device) => device.manufacturer
  }
  , {name: gettext('SDK'), render: (device) => device.sdk, sortValue: (device) => device.sdk}
  , {name: gettext('ABI'), render: (device) => device.abi, sortValue: (device) => device.abi}
  , {
    name: gettext('CPU Platform')
    , render: (device) => device.cpuPlatform
    , sortValue: (device) => device.cpuPlatform
  }
  , {
    name: gettext('OpenGL ES version')
    , render: (device) => device.openGLESVersion
    , sortValue: (device) => device.openGLESVersion
  }
  , {name: gettext('Market name'), render: (device) => device.marketName, sortValue: (device) => device.marketName}
  , {name: gettext('Phone IMEI'), render: (device) => device.phone?.imei, sortValue: (device) => device.phone?.imei}
  , {name: gettext('Location'), render: (device) => device.provider?.name, sortValue: (device) => device.provider?.name}
  , {
    name: gettext('Group Origin')
    , render: (device) => device.group?.originName
    , sortValue: (device) => device.group?.originName
  }
]

const selectedByDefault = new Set([
  'Model', 'Serial', 'OS', 'Screen', 'Manufacturer', 'SDK', 'Market name', 'Location', 'Group Origin'
])

const defaultDeviceData = tableDataDefaults(deviceColumns.map((column) => ({
  name: column.name
  , selected: selectedByDefault.has(column.name)
})))

function useAvailableSource(group: StfGroup): {source: Collection<SettingsDevice>, loading: boolean} {
  const origin = useGroupsStore((state) => state.originDevices)
  const standardizable = useGroupsStore((state) => state.standardizableDevices)
  const transient = useGroupsStore((state) => state.transient)
  if (group.class === 'bookable') {
    return {source: origin, loading: false}
  }
  if (group.class === 'standard') {
    return {source: standardizable, loading: false}
  }
  if (transient.groupId === group.id) {
    return {source: transient.devices, loading: transient.loading}
  }
  return {source: {}, loading: true}
}

export function GroupDevices({group}: {group: StfGroup}) {
  const {t} = useTranslation()
  const owner = useGroupsStore((state) => getItem(state.users, group.owner.email))
  const [view, setView] = useState<string>('group')
  const transientGroup = !isOriginGroup(group.class)
  const {source, loading} = useAvailableSource(group)
  const isRoot = group.privilege === 'root'

  useEffect(() => {
    if (!transientGroup) {
      return undefined
    }
    watchTransientDevices(group.id)
    return () => watchTransientDevices(null)
  }, [group.id, transientGroup])

  const groupDevices = useMemo(
    () => group.devices.map((serial) => getItem(source, serial)).filter((device) => Boolean(device)) as
      SettingsDevice[]
    , [group.devices, source]
  )
  const availableDevices = useMemo(() => {
    const members = new Set(group.devices)
    return listOf(source).filter((device) => !members.has(device.serial))
  }, [group.devices, source])

  if (loading) {
    return <Center p='xl'><Loader size='sm' /></Center>
  }

  const quotaReached = t('Groups duration quota is reached')

  return (
    <Tabs value={view} onChange={(value) => value && setView(value)} variant='pills' keepMounted={false}>
      <Tabs.List mb='md'>
        <Tabs.Tab
          value='group'
          leftSection={<IconDeviceMobile size={14} />}
          rightSection={<Badge size='xs' variant='white' color='gray'>{groupDevices.length}</Badge>}
        >
          {t('Group devices')}
        </Tabs.Tab>
        <Tabs.Tab
          value='available'
          leftSection={<IconPlus size={14} />}
          rightSection={<Badge size='xs' variant='white' color='gray'>{availableDevices.length}</Badge>}
        >
          {t('Available devices')}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value='group' className='group-devices'>
        <ObjectsTable
          rows={groupDevices}
          rowKey={(device) => device.serial}
          columns={deviceColumns}
          settingKey='groupDeviceData'
          defaultData={defaultDeviceData}
          columnChoice
          searchLabel={t('Group device selection')}
          emptyMessage={t('No group devices')}
          emptyIcon={<IconDeviceMobile size={30} />}
          canSelect={() => !isRoot}
          rowAction={(device) => (
            <ActionIcon
              variant='subtle'
              color='red'
              aria-label={t('Remove')}
              className='group-remove-device'
              disabled={isRoot}
              onClick={() => removeGroupDevice(group, device)}
            >
              <IconTrash size={16} />
            </ActionIcon>
          )}
          actions={(selected, clear) => (
            <Button
              size='xs'
              color='red'
              leftSection={<IconTrash size={14} />}
              disabled={!selected.length || isRoot}
              onClick={async() => {
                if (await removeGroupDevices(group, selected)) {
                  clear()
                }
              }}
            >
              {t('Remove')}
            </Button>
          )}
        />
      </Tabs.Panel>
      <Tabs.Panel value='available' className='available-devices'>
        <ObjectsTable
          rows={availableDevices}
          rowKey={(device) => device.serial}
          columns={deviceColumns}
          settingKey='deviceData'
          defaultData={defaultDeviceData}
          columnChoice
          searchLabel={t('Available device selection')}
          emptyMessage={t('No available devices')}
          emptyIcon={<IconDeviceMobile size={30} />}
          rowAction={(device) => {
            const allowed = canAddDevices(group, owner, 1)
            return (
              <Tooltip label={quotaReached} disabled={allowed}>
                <span>
                  <ActionIcon
                    variant='light'
                    aria-label={t('Add')}
                    className='group-add-device'
                    disabled={!allowed}
                    onClick={() => addGroupDevice(group, device)}
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </span>
              </Tooltip>
            )
          }}
          actions={(selected, clear) => {
            const allowed = canAddDevices(group, owner, selected.length)
            return (
              <Tooltip label={quotaReached} disabled={!selected.length || allowed}>
                <span>
                  <Button
                    size='xs'
                    variant='filled'
                    leftSection={<IconPlus size={14} />}
                    disabled={!selected.length || !allowed}
                    onClick={async() => {
                      if (await addGroupDevices(group, selected)) {
                        clear()
                      }
                    }}
                  >
                    {t('Add')}
                  </Button>
                </span>
              </Tooltip>
            )
          }}
        />
      </Tabs.Panel>
    </Tabs>
  )
}
