import {useState} from 'react'
import {ActionIcon, Button, Card, Group, Paper, Slider, Stack, Text, Tooltip} from '@mantine/core'
import {useDebouncedValue} from '@mantine/hooks'
import {IconCamera, IconMinus, IconPlus, IconTrash} from '@tabler/icons-react'
import {formatDate} from '@/core/date-format'
import {useTranslation} from '@/core/i18n'
import {NothingToShow} from '@/ui/NothingToShow'
import {notifyFailure} from '@/ui/notify'
import type {PaneProps} from '../../types'
import {
  addScreenshot
  , clearScreenshots
  , maxShotSize
  , minShotSize
  , screenshotsStore
  , shotSizeParameter
  , shotSizeStep
  , useScreenshotSize
  , zoomStep
  , type Screenshot
} from './screenshotsStore'
import classes from './ScreenshotsPane.module.css'

function ShotImage({shot, size}: {shot: Screenshot, size: number}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <a href={shot.href} target='_blank' rel='noreferrer' className={classes.link}>
      <img
        src={shot.href + shotSizeParameter(size, 1)}
        srcSet={`${shot.href + shotSizeParameter(size, 2)} 2x`}
        alt=''
        className={`screenshot-image ${classes.image} ${loaded ? '' : classes.loading}`}
        onLoad={() => setLoaded(true)}
      />
    </a>
  )
}

export default function ScreenshotsPane({device, control}: PaneProps) {
  const {t} = useTranslation()
  const shots = screenshotsStore.useValue(device.serial)
  const {size, setSize} = useScreenshotSize()
  const [requestedSize] = useDebouncedValue(size, 100)
  const [taking, setTaking] = useState(0)
  const empty = shots.length === 0

  function takeScreenShot() {
    setTaking((count) => count + 1)
    control.screenshot()
      .then((result) => {
        addScreenshot(device.serial, {
          id: result.body.id || result.body.href
          , href: result.body.href
          , date: result.body.date
        })
      })
      .catch((error) => {
        notifyFailure(error, t('Screenshot'))
      })
      .finally(() => setTaking((count) => count - 1))
  }

  return (
    <Stack gap='md' className='stf-screenshots'>
      <Paper withBorder p='xs' className={classes.toolbar}>
        <Group justify='space-between' gap='sm'>
          <Group gap='xs'>
            <Tooltip label={t('Take Screenshot')}>
              <Button
                variant='filled'
                leftSection={<IconCamera size={16} />}
                loading={taking > 0}
                onClick={takeScreenShot}
              >
                {t('Screenshot')}
              </Button>
            </Tooltip>
            <Button
              color='red'
              leftSection={<IconTrash size={16} />}
              disabled={empty}
              onClick={() => clearScreenshots(device.serial)}
            >
              {t('Clear')}
            </Button>
          </Group>
          <Group gap={6} wrap='nowrap'>
            <ActionIcon
              variant='subtle'
              disabled={empty}
              onClick={() => setSize(size - zoomStep)}
            >
              <IconMinus size={16} />
            </ActionIcon>
            <Slider
              className={classes.zoom}
              min={minShotSize}
              max={maxShotSize}
              step={shotSizeStep}
              value={size}
              onChange={setSize}
              disabled={empty}
              label={(value) => `${value}px`}
              size='sm'
            />
            <ActionIcon
              variant='subtle'
              disabled={empty}
              onClick={() => setSize(size + zoomStep)}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Group>
        </Group>
      </Paper>

      {empty ?
        <NothingToShow message={t('No screenshots taken')} icon={<IconCamera size={30} />} /> :
        <div className={`screenshots-icon-view selectable ${classes.gallery}`}>
          {shots.map((shot) => (
            <Card key={shot.id} padding='xs' className={`screenshots-icon-item ${classes.item}`} w={size}>
              <Card.Section inheritPadding py={6}>
                <Group justify='space-between' gap='xs' wrap='nowrap'>
                  <Text size='sm' fw={600} truncate>{device.name || device.enhancedName}</Text>
                  <Text size='xs' c='dimmed' ff='monospace'>{formatDate(shot.date, 'HH:mm:ss')}</Text>
                </Group>
              </Card.Section>
              <Card.Section>
                <ShotImage shot={shot} size={requestedSize} />
              </Card.Section>
            </Card>
          ))}
        </div>}
    </Stack>
  )
}
