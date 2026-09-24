import {useEffect, useState, type ComponentType, type ReactNode} from 'react'
import {Button, Group, Image, Progress, Table, Text, type MantineColor} from '@mantine/core'
import {modals} from '@mantine/modals'
import {
  IconBolt
  , IconCpu
  , IconCreditCard
  , IconDatabase
  , IconDeviceMobile
  , IconDeviceTablet
  , IconInfoCircle
  , IconAntennaBars5
  , IconMapPin
  , IconPhone
  , IconPhoto
} from '@tabler/icons-react'
import {displayDensities, humanizedBool, networkTypes} from '@/core/devices/enhance'
import type {Device} from '@/core/devices/types'
import {gettext, translate, useTranslation} from '@/core/i18n'
import {NothingToShow} from '@/ui/NothingToShow'
import {notifyFailure} from '@/ui/notify'
import {WidgetCard} from '@/ui/WidgetCard'
import type {PaneProps} from '../../types'
import classes from './InfoPane.module.css'

interface InfoRow {
  label: string
  value: ReactNode
}

interface InfoSection {
  id: string
  title: string
  icon: ComponentType<{size?: number}>
  color: MantineColor
  rows: InfoRow[]
  actions?: ReactNode
}

const networkSubTypes: Record<string, string> = {
  mobile_wifi: gettext('WiFi')
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function withUnit(value: unknown, unit: string): string {
  return present(value) ? `${value}${unit}` : '-'
}

function plain(value: unknown): string {
  return present(value) ? String(value) : '-'
}

function rounded(value?: number): string {
  return present(value) ? String(Math.round(Number(value) * 100) / 100) : '-'
}

function translatedLookup(table: Record<string, string>, key?: string | null): string {
  if (!present(key)) {
    return '-'
  }
  const msgid = table[key as string]
  return msgid ? translate(msgid) : String(key)
}

function density(value?: number): string {
  if (!present(value)) {
    return '-'
  }
  return displayDensities[String(value)] || String(value)
}

function releaseDate(value: string | undefined, language: string): string {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleDateString(language.replace('_', '-'), {dateStyle: 'medium'})
}

function BatteryLevel({device}: {device: Device}) {
  if (!device.battery || !device.battery.scale) {
    return <>-</>
  }
  const percentage = Math.round(device.battery.level / device.battery.scale * 100)
  return (
    <Progress.Root size='lg' radius='xl' className={classes.battery}>
      <Progress.Section value={percentage} color='green'>
        <Progress.Label>{percentage}%</Progress.Label>
      </Progress.Section>
    </Progress.Root>
  )
}

function DevicePhoto({url}: {url: string}) {
  const {t} = useTranslation()
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <NothingToShow message={t('No photo available')} icon={<IconPhoto size={30} />} />
  }
  return (
    <div className={classes.photo}>
      <Image src={url} alt='' fit='contain' mah='75vh' onError={() => setFailed(true)} />
    </div>
  )
}

function openDevicePhoto(device: Device) {
  modals.open({
    title: (
      <Group gap='xs'>
        <IconDeviceMobile size={18} />
        <Text fw={600}>{device.name}</Text>
      </Group>
    )
    , size: 'xl'
    , centered: true
    , classNames: {content: 'stf-lightbox-image'}
    , children: <DevicePhoto url={`/static/app/devices/photo/x800/${device.image}`} />
  })
}

function InfoTable({rows}: {rows: InfoRow[]}) {
  const {t} = useTranslation()
  return (
    <Table striped highlightOnHover verticalSpacing={6} className='table-infocard'>
      <Table.Tbody>
        {rows.map((row, index) => (
          <Table.Tr key={row.label || index}>
            <Table.Th className={classes.label}>{row.label && t(row.label)}</Table.Th>
            <Table.Td className={classes.value}>{row.value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function useSdCardMounted(control: PaneProps['control']): boolean | undefined {
  const [mounted, setMounted] = useState<boolean>()
  useEffect(() => {
    let active = true
    control.getSdStatus()
      .then((result) => {
        if (active) {
          setMounted(result.lastData === 'sd_mounted')
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [control])
  return mounted
}

export default function InfoPane({device, control}: PaneProps) {
  const {t, language} = useTranslation()
  const sdCardMounted = useSdCardMounted(control)
  const {battery, display, network, phone, cpu, memory} = device
  const photoRows: InfoRow[] = device.name && device.image ? [{
    label: ''
    , value: (
      <Button
        size='compact-xs'
        variant='default'
        leftSection={<IconPhoto size={14} />}
        onClick={() => openDevicePhoto(device)}
      >
        {t('Device Photo')}
      </Button>
    )
  }] : []

  const sections: InfoSection[] = [
    {
      id: 'physical'
      , title: gettext('Physical Device')
      , icon: IconMapPin
      , color: 'pink'
      , actions: (
        <Button size='compact-xs' leftSection={<IconInfoCircle size={14} />} onClick={() => control.identify().catch(notifyFailure)}>
          {t('Find Device')}
        </Button>
      )
      , rows: [
        {label: gettext('Place'), value: plain(device.provider?.name)}
        , ...photoRows
      ]
    }
    , {
      id: 'battery'
      , title: gettext('Battery')
      , icon: IconBolt
      , color: 'yellow'
      , rows: [
        {label: gettext('Health'), value: device.enhancedBatteryHealth || '-'}
        , {label: gettext('Power Source'), value: device.enhancedBatterySource || '-'}
        , {label: gettext('Status'), value: device.enhancedBatteryStatus || '-'}
        , {label: gettext('Level'), value: <BatteryLevel device={device} />}
        , {label: gettext('Temperature'), value: withUnit(battery?.temp, ' °C')}
        , {label: gettext('Voltage'), value: withUnit(battery?.voltage, ' v')}
      ]
    }
    , {
      id: 'display'
      , title: gettext('Display')
      , icon: IconDeviceTablet
      , color: 'blue'
      , rows: [
        {label: gettext('Size'), value: display?.inches ? `${display.inches}″` : '-'}
        , {label: gettext('Density'), value: density(display?.density)}
        , {label: gettext('FPS'), value: rounded(display?.fps)}
        , {label: gettext('Width'), value: withUnit(display?.width, ' px')}
        , {label: gettext('Height'), value: withUnit(display?.height, ' px')}
        , {label: gettext('ID'), value: plain(display?.id)}
        , {label: gettext('Orientation'), value: withUnit(display?.rotation, '°')}
        , {label: gettext('Encrypted'), value: humanizedBool(display?.secure)}
        , {label: gettext('X DPI'), value: plain(display?.xdpi)}
        , {label: gettext('Y DPI'), value: plain(display?.ydpi)}
      ]
    }
    , {
      id: 'network'
      , title: gettext('Network')
      , icon: IconAntennaBars5
      , color: 'teal'
      , rows: [
        {label: gettext('Connected'), value: humanizedBool(network?.connected)}
        , {label: gettext('Airplane Mode'), value: humanizedBool(device.airplaneMode)}
        , {label: gettext('Using Fallback'), value: humanizedBool(network?.failover)}
        , {label: gettext('Roaming'), value: humanizedBool(network?.roaming)}
        , {label: gettext('Type'), value: translatedLookup(networkTypes, network?.type)}
        , {label: gettext('Sub Type'), value: translatedLookup(networkSubTypes, network?.subtype)}
      ]
    }
    , {
      id: 'sim'
      , title: gettext('SIM')
      , icon: IconCreditCard
      , color: 'grape'
      , rows: [
        {label: gettext('Carrier'), value: plain(device.operator)}
        , {label: gettext('Network'), value: plain(phone?.network)}
        , {label: gettext('Number'), value: plain(phone?.phoneNumber)}
        , {label: gettext('IMEI'), value: plain(phone?.imei)}
        , {label: gettext('IMSI'), value: plain(phone?.imsi)}
        , {label: gettext('ICCID'), value: <Text span size='xs'>{plain(phone?.iccid)}</Text>}
      ]
    }
    , {
      id: 'hardware'
      , title: gettext('Hardware')
      , icon: IconPhone
      , color: 'green'
      , rows: [
        {label: gettext('Manufacturer'), value: plain(device.manufacturer)}
        , {label: gettext('Product'), value: plain(device.name)}
        , {label: gettext('Model'), value: plain(device.model)}
        , {label: gettext('Serial'), value: device.serial}
        , {label: gettext('Released'), value: releaseDate(device.releasedAt, language)}
      ]
    }
    , {
      id: 'platform'
      , title: gettext('Platform')
      , icon: IconDeviceMobile
      , color: 'cyan'
      , rows: [
        {label: gettext('OS'), value: plain(device.platform)}
        , {label: gettext('Version'), value: plain(device.version)}
        , {label: gettext('SDK'), value: plain(device.sdk)}
        , {label: gettext('ABI'), value: plain(device.abi)}
      ]
    }
    , {
      id: 'cpu'
      , title: gettext('CPU')
      , icon: IconCpu
      , color: 'gray'
      , rows: [
        {label: gettext('Name'), value: plain(cpu?.name)}
        , {label: gettext('Cores'), value: plain(cpu?.cores)}
        , {label: gettext('Frequency'), value: withUnit(cpu?.freq, ' GHz')}
      ]
    }
    , {
      id: 'memory'
      , title: gettext('Memory')
      , icon: IconDatabase
      , color: 'orange'
      , rows: [
        {label: gettext('RAM'), value: memory?.ram ? `${memory.ram} MB` : '-'}
        , {label: gettext('ROM'), value: memory?.rom ? `${memory.rom} MB` : '-'}
        , {label: gettext('SD Card Mounted'), value: humanizedBool(sdCardMounted)}
      ]
    }
  ]

  return (
    <div className={`stf-info selectable ${classes.masonry}`}>
      {sections.map((section) => (
        <WidgetCard
          key={section.id}
          title={t(section.title)}
          icon={section.icon}
          color={section.color}
          actions={section.actions}
          className={`${classes.item} stf-info-${section.id}`}
        >
          <InfoTable rows={section.rows} />
        </WidgetCard>
      ))}
    </div>
  )
}
