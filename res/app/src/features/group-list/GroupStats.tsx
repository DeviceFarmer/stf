import type {ReactNode} from 'react'
import {Group, Paper, Progress, SimpleGrid, Text, ThemeIcon} from '@mantine/core'
import {IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconWorld} from '@tabler/icons-react'
import type {User} from '@/core/app-state'
import {getDuration} from '@/core/common'
import type {Group as StfGroup} from '@/core/groups-api'
import {useTranslation} from '@/core/i18n'
import classes from './GroupListPage.module.css'

function StatCard({icon, color, value, label}: {
  icon: ReactNode
  color: string
  value: number
  label: string
}) {
  return (
    <Paper withBorder p='md' className={classes.statCard}>
      <Group gap='md' wrap='nowrap'>
        <ThemeIcon size={44} radius='md' variant='light' color={color}>
          {icon}
        </ThemeIcon>
        <div>
          <Text fz={26} fw={700} lh={1.1} c={color}>{value}</Text>
          <Text size='sm' c='dimmed'>{label}</Text>
        </div>
      </Group>
    </Paper>
  )
}

export function GroupStats({groups}: {groups: StfGroup[]}) {
  const {t} = useTranslation()
  const active = groups.filter((group) => group.isActive).length
  const pending = groups.filter((group) => !group.isActive && group.state === 'pending').length

  return (
    <SimpleGrid cols={{base: 2, md: 4}} spacing='md' className='group-stats'>
      <StatCard icon={<IconWorld size={24} />} color='blue' value={groups.length} label={t('Total groups')} />
      <StatCard icon={<IconPlayerPlay size={24} />} color='green' value={active} label={t('Active groups')} />
      <StatCard
        icon={<IconPlayerPause size={24} />}
        color='orange'
        value={groups.length - active - pending}
        label={t('Ready groups')}
      />
      <StatCard icon={<IconPlayerStop size={24} />} color='pink' value={pending} label={t('Pending groups')} />
    </SimpleGrid>
  )
}

function quotaPercent(consumed: number | undefined, allocated: number | undefined): number {
  if (!consumed || !allocated) {
    return 0
  }
  return Math.floor((consumed / allocated) * 100)
}

function quotaColor(percent: number): string {
  if (percent < 25) {
    return 'green'
  }
  if (percent < 50) {
    return 'blue'
  }
  return percent < 75 ? 'yellow' : 'red'
}

function QuotaBar({label, percent, detail}: {label: string, percent: number, detail: string}) {
  return (
    <Paper withBorder p='md'>
      <Group justify='space-between' mb={8} wrap='nowrap' gap='xs'>
        <Text size='sm' fw={500} truncate>{label}</Text>
        <Text size='sm' fw={700} c={quotaColor(percent)}>{percent}%</Text>
      </Group>
      <Progress
        value={Math.min(percent, 100)}
        color={quotaColor(percent)}
        size='lg'
        radius='xl'
        striped
        aria-label={label}
      />
      <Text size='xs' c='dimmed' mt={6}>{detail}</Text>
    </Paper>
  )
}

export function GroupQuotaStats({user}: {user: User}) {
  const {t} = useTranslation()
  const consumed = user.groups?.quotas?.consumed
  const allocated = user.groups?.quotas?.allocated
  const name = {'user.name': user.name}

  return (
    <SimpleGrid cols={{base: 1, sm: 2}} spacing='md' className='group-quota-stats'>
      <QuotaBar
        label={t('{{user.name}} groups number use', name)}
        percent={quotaPercent(consumed?.number, allocated?.number)}
        detail={`${consumed?.number ?? 0} / ${allocated?.number ?? 0}`}
      />
      <QuotaBar
        label={t('{{user.name}} groups duration use', name)}
        percent={quotaPercent(consumed?.duration, allocated?.duration)}
        detail={`${getDuration(consumed?.duration ?? 0)} / ${getDuration(allocated?.duration ?? 0)}`}
      />
    </SimpleGrid>
  )
}
