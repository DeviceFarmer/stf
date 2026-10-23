import {Image, type ImageProps} from '@mantine/core'
import type {ComponentPropsWithoutRef} from 'react'
import {deviceImageUrl} from '../../../../lib/util/device-image-paths'

export {deviceImageUrl}

type DeviceImageProps = ImageProps & Omit<ComponentPropsWithoutRef<'img'>, keyof ImageProps>

export function DeviceImage(props: DeviceImageProps) {
  return (
    <Image
      fit='contain'
      w='auto'
      fallbackSrc={deviceImageUrl(null, 'photo/x800')}
      {...props}
    />
  )
}
