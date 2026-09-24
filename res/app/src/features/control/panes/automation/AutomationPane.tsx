import {SimpleGrid} from '@mantine/core'
import type {PaneProps} from '../../types'
import {DeviceSettingsCard} from './DeviceSettingsCard'
import {StoreAccountCard} from './StoreAccountCard'

export default function AutomationPane({control}: PaneProps) {
  return (
    <SimpleGrid minColWidth='min(380px, 100%)' autoFlow='auto-fit' spacing='md' className='stf-automation'>
      <StoreAccountCard control={control} />
      <DeviceSettingsCard control={control} />
    </SimpleGrid>
  )
}
