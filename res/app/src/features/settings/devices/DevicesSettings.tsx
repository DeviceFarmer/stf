import {useMemo, useState} from 'react'
import {
  Alert
  , Button
  , Center
  , Collapse
  , Group
  , Loader
  , SegmentedControl
  , Table
  , Text
  , ThemeIcon
  , Tooltip
} from '@mantine/core'
import {
  IconDeviceMobile
  , IconFilter
  , IconLock
  , IconLockOpen
  , IconSearch
  , IconTrash
} from '@tabler/icons-react'
import sortBy from 'lodash/sortBy'
import {devicesApi, type DeviceRemovalFilters} from '@/core/devices-api'
import {gettext, useTranslation} from '@/core/i18n'
import {useSetting} from '@/core/settings'
import {errorMessage, openGenericModal, withErrorModal} from '@/ui/modals'
import {NothingToShow} from '@/ui/NothingToShow'
import {PageControls, PerPageSelect, SearchInput, useItemsPerPage, usePaged} from '@/ui/Pager'
import {searchFilter} from '@/ui/paging'
import {WidgetCard} from '@/ui/WidgetCard'
import type {SettingsDevice} from '../groups/types'
import {useSettingsDevices} from './settings-devices'
import classes from './DevicesSettings.module.css'

const defaultRemovingFilters: DeviceRemovalFilters = {
  present: 'False'
  , booked: 'False'
  , annotated: 'False'
  , controlled: 'False'
}

const removingFilterOptions = [
  {value: 'True', label: gettext('True')}
  , {value: 'False', label: gettext('False')}
  , {value: 'Any', label: gettext('Any')}
]

const removingFilterFields: Array<{key: keyof DeviceRemovalFilters, label: string, description: string}> = [
  {key: 'present', label: gettext('Present'), description: gettext('Device presence state')}
  , {key: 'booked', label: gettext('Booked'), description: gettext('Device booking state')}
  , {key: 'annotated', label: gettext('Annotated'), description: gettext('Device notes state')}
  , {key: 'controlled', label: gettext('Controlled'), description: gettext('Device controlling state')}
]

function deviceName(device: SettingsDevice): string {
  const name = [device.manufacturer, device.model].filter(Boolean).join(' ')
  return device.marketName ? `${name} (${device.marketName})` : name
}

function RemovingFilters({filters, onChange}: {
  filters: DeviceRemovalFilters
  onChange: (filters: DeviceRemovalFilters) => void
}) {
  const {t} = useTranslation()

  return (
    <div className={`device-filters ${classes.filters}`}>
      <Group gap={8}>
        <IconTrash size={16} />
        <Text fw={600} size='sm'>{t('Removing filters')}</Text>
      </Group>
      <div className={`device-filters-items ${classes.filterGrid}`}>
        {removingFilterFields.map(({key, label, description}) => (
          <div key={key} className={`device-filters-item device-filter-${key}`}>
            <Text size='sm' fw={500}>{t(label)}</Text>
            <Text size='xs' c='dimmed' mb={6}>{t(description)}</Text>
            <SegmentedControl
              size='xs'
              fullWidth
              value={filters[key]}
              onChange={(value) => onChange({...filters, [key]: value})}
              data={removingFilterOptions.map((option) => ({value: option.value, label: t(option.label)}))}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DevicesSettings() {
  const {t} = useTranslation()
  const {devices, loading, error} = useSettingsDevices()
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(true)
  const [storedFilters, setFilters] = useSetting<DeviceRemovalFilters>('DevicesRemovingFilters', defaultRemovingFilters)
  const [perPage, setPerPage] = useItemsPerPage('deviceItemsPerPage')
  const filters = {...defaultRemovingFilters, ...storedFilters}

  const filtered = useMemo(
    () => sortBy(searchFilter(devices, search), (device) => (device.model || '').toLowerCase())
    , [devices, search]
  )

  const {items: visible, page, pageCount, setPage} = usePaged(filtered, perPage)

  async function removeDevice(serial: string) {
    if (confirmRemove && !await openGenericModal({
      type: 'Warning'
      , message: gettext('Really delete this device?')
      , cancel: true
    })) {
      return
    }
    await withErrorModal(() => devicesApi.removeDevice(serial, filters))
  }

  async function removeSelection() {
    if (confirmRemove && !await openGenericModal({
      type: 'Warning'
      , message: gettext('Really delete this selection of devices?')
      , cancel: true
    })) {
      return
    }
    const serials = search ? filtered.map((device) => device.serial) : undefined
    await withErrorModal(() => devicesApi.removeDevices(filters, serials))
  }

  function body() {
    if (loading) {
      return <Center py='xl'><Loader /></Center>
    }
    if (error) {
      return <Alert m='md' variant='light' color='red'>{errorMessage(error)}</Alert>
    }
    if (!devices.length) {
      return <NothingToShow icon={<IconDeviceMobile size={30} />} message={t('No Devices')} />
    }
    return (
      <>
        <div className={classes.toolbar}>
          <div className={`device-header ${classes.pager}`}>
            <SearchInput
              className={classes.search}
              value={search}
              onChange={(value) => {
                setSearch(value)
                setPage(1)
              }}
              label={t('Device selection')}
            />
            <PerPageSelect
              value={perPage}
              onChange={(value) => {
                setPerPage(value)
                setPage(1)
              }}
            />
            <PageControls
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
              total={filtered.length}
              totalClassName='stf-pager-devices-total-items'
            />
          </div>
          <Group gap='xs' className='device-actions'>
            <Tooltip label={t('Set filters for device removing')} withArrow openDelay={500}>
              <Button
                size='xs'
                color='red'
                variant={showFilters ? 'filled' : 'light'}
                leftSection={<IconFilter size={14} />}
                className='device-filters-toggle'
                aria-pressed={showFilters}
                onClick={() => setShowFilters(!showFilters)}
              >
                {t('Filters')}
              </Button>
            </Tooltip>
            <Tooltip label={t('Enable/Disable confirmation for device removing')} withArrow openDelay={500}>
              <Button
                size='xs'
                color={confirmRemove ? 'green' : 'yellow'}
                variant={confirmRemove ? 'filled' : 'outline'}
                leftSection={confirmRemove ? <IconLock size={14} /> : <IconLockOpen size={14} />}
                className='device-confirm-remove'
                aria-pressed={confirmRemove}
                onClick={() => setConfirmRemove(!confirmRemove)}
              >
                {t('Confirm Remove')}
              </Button>
            </Tooltip>
            <Tooltip label={t('Remove the device selection')} withArrow openDelay={500}>
              <Button
                size='xs'
                color='red'
                variant='filled'
                leftSection={<IconTrash size={14} />}
                className='device-remove-selection'
                disabled={!filtered.length}
                onClick={removeSelection}
              >
                {t('Remove')}
              </Button>
            </Tooltip>
          </Group>
        </div>
        <Collapse expanded={showFilters}>
          <RemovingFilters filters={filters} onChange={setFilters} />
        </Collapse>
        {filtered.length ? (
          <Table.ScrollContainer minWidth={960}>
            <Table highlightOnHover verticalSpacing='sm' className='devices-list'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Device')}</Table.Th>
                  <Table.Th>{t('Serial')}</Table.Th>
                  <Table.Th>{t('OS')}</Table.Th>
                  <Table.Th>{t('Screen')}</Table.Th>
                  <Table.Th>{t('SDK')}</Table.Th>
                  <Table.Th>{t('Location')}</Table.Th>
                  <Table.Th>{t('Group Origin')}</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((device) => (
                  <Table.Tr key={device.serial} className='device-line selectable' data-serial={device.serial}>
                    <Table.Td>
                      <div className={classes.deviceCell}>
                        <ThemeIcon variant='light' color='gray' radius='md' size={32}>
                          <IconDeviceMobile size={18} />
                        </ThemeIcon>
                        <Text size='sm' className={`device-list-name ${classes.name}`}>{deviceName(device)}</Text>
                      </div>
                    </Table.Td>
                    <Table.Td className={`device-list-id ${classes.mono}`}>{device.serial}</Table.Td>
                    <Table.Td>{device.version}</Table.Td>
                    <Table.Td>{device.displayStr}</Table.Td>
                    <Table.Td>{device.sdk}</Table.Td>
                    <Table.Td>{device.provider?.name}</Table.Td>
                    <Table.Td>{device.group?.originName}</Table.Td>
                    <Table.Td ta='right'>
                      <Button
                        size='xs'
                        variant='light'
                        color='red'
                        leftSection={<IconTrash size={14} />}
                        className='device-remove'
                        onClick={() => removeDevice(device.serial)}
                      >
                        {t('Remove')}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <NothingToShow icon={<IconSearch size={30} />} message={t('No Devices')} />
        )}
      </>
    )
  }

  return (
    <WidgetCard
      className='stf-devices'
      icon={IconDeviceMobile}
      title={t('Device list')}
      flush
    >
      {body()}
    </WidgetCard>
  )
}
