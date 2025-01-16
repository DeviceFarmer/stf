import { memo } from 'react'
import { Flex, Image } from '@vkontakte/vkui'

import { BROWSER_ICON_MAP } from '@/constants/browser-icon-map'

import type { DeviceBrowserAppsItem } from '@/generated/types'

type BrowserCellProps = {
  apps?: DeviceBrowserAppsItem[]
}

export const BrowserCell = memo(({ apps }: BrowserCellProps) => (
  <Flex>
    {apps?.map(({ id, type }) => (
      <Image key={id} alt={type} size={24} src={type && BROWSER_ICON_MAP[type]} title={type} />
    ))}
  </Flex>
))
