import {SimpleGrid} from '@mantine/core'
import {AccessTokensCard} from './AccessTokensCard'
import {AdbKeysCard} from './AdbKeysCard'

export default function KeysSettings() {
  return (
    <SimpleGrid cols={{base: 1, lg: 2}} spacing='lg' className='stf-keys-settings'>
      <AccessTokensCard />
      <AdbKeysCard />
    </SimpleGrid>
  )
}
