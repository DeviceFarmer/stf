import {useMemo, type ReactNode} from 'react'
import {Group, Text, ThemeIcon} from '@mantine/core'
import {IconCircleCheck, IconDevices, IconTrophy, IconUser, IconUsers} from '@tabler/icons-react'
import type {Device} from '@/core/devices/types'
import {useTranslation} from '@/core/i18n'
import {currentUser} from '@/core/user'
import classes from './DeviceList.module.css'

function Stat({icon, color, value, label, labelClassName}: {
  icon: ReactNode
  color: string
  value: number
  label: string
  labelClassName?: string
}) {
  return (
    <Group gap={8} wrap='nowrap' className={classes.stat}>
      <ThemeIcon variant='light' color={color} size={30} radius='md'>
        {icon}
      </ThemeIcon>
      <div>
        <Text className={`number ${classes.statNumber}`}>{value}</Text>
        <Text className={`text ${labelClassName || ''} ${classes.statLabel}`} truncate>{label}</Text>
      </div>
    </Group>
  )
}

export function DeviceStats({devices, adminMode}: {devices: Device[], adminMode: boolean}) {
  const {t} = useTranslation()
  const counter = useMemo(() => devices.reduce((total, device) => ({
    usable: total.usable + (device.usable ? 1 : 0)
    , busy: total.busy + (device.owner ? 1 : 0)
    , using: total.using + (device.using ? 1 : 0)
  }), {usable: 0, busy: 0, using: 0}), [devices])

  return (
    <Group gap='lg' wrap='wrap' className={`device-stats ${classes.stats}`}>
      <Stat icon={<IconDevices size={18} />} color='blue' value={devices.length} label={t('Total Devices')} />
      <Stat icon={<IconCircleCheck size={18} />} color='green' value={counter.usable} label={t('Usable Devices')} />
      <Stat icon={<IconUsers size={18} />} color='pink' value={counter.busy} label={t('Busy Devices')} />
      <Stat
        icon={adminMode ? <IconTrophy size={18} /> : <IconUser size={18} />}
        color='orange'
        value={counter.using}
        label={currentUser.name}
        labelClassName={`current-user-name ${classes.userLabel}`}
      />
    </Group>
  )
}
