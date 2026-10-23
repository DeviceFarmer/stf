import {SimpleGrid} from '@mantine/core'
import {usePlatform} from '@/ui/modes'
import type {PaneProps} from '../../types'
import {AppsCard} from './apps/AppsCard'
import {ClipboardCard} from './clipboard/ClipboardCard'
import {InstallCard} from './install/InstallCard'
import {NavigationCard} from './navigation/NavigationCard'
import {RemoteDebugCard} from './remote-debug/RemoteDebugCard'
import {ShellCard} from './shell/ShellCard'
import {IosDeviceHealth} from '@/ui/IosDeviceHealth'
import {IosControlsCard} from './ios-controls/IosControlsCard'

export default function DashboardPane({device, control}: PaneProps) {
  const [platform] = usePlatform()

  if (device.platform === 'iOS') {
    return <SimpleGrid type='container' cols={{base: 1, '720px': 2}} spacing='md'>
      <IosDeviceHealth device={device} />
      <IosControlsCard control={control} device={device} />
      <ClipboardCard control={control} inputOnly />
      <InstallCard control={control} />
    </SimpleGrid>
  }

  return (
    <SimpleGrid type='container' cols={{base: 1, '720px': 2}} spacing='md' verticalSpacing='md'>
      <NavigationCard device={device} control={control} />
      <ClipboardCard control={control} />
      <InstallCard control={control} />
      {platform === 'native' && <ShellCard control={control} />}
      <AppsCard control={control} />
      <RemoteDebugCard device={device} control={control} />
    </SimpleGrid>
  )
}
