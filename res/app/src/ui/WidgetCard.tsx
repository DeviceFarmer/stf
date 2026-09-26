import type {ComponentType, ReactNode} from 'react'
import {Link} from 'react-router'
import {ActionIcon, Card, Group, Text, ThemeIcon, Tooltip, type MantineColor} from '@mantine/core'
import {IconHelpCircle} from '@tabler/icons-react'
import classes from './WidgetCard.module.css'

export function WidgetCard({title, icon: Icon, color, actions, help, flush, className, children}: {
  title?: ReactNode
  icon?: ComponentType<{size?: number, stroke?: number}>
  color?: MantineColor
  actions?: ReactNode
  help?: {topic: string, tooltip: string}
  flush?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Card padding='md' className={className}>
      {title && (
        <Card.Section withBorder inheritPadding py='xs' className={`${classes.header} heading`}>
          <Group justify='space-between' wrap='nowrap' gap='xs'>
            <Group gap='sm' wrap='nowrap' miw={0}>
              {Icon && (
                <ThemeIcon variant='light' {...(color === undefined ? {} : {color})} size='md' radius='md'>
                  <Icon size={18} stroke={1.8} />
                </ThemeIcon>
              )}
              <Text fw={600} size='sm' truncate>{title}</Text>
            </Group>
            {(actions || help) && (
              <Group gap={6} wrap='nowrap'>
                {actions}
                {help && (
                  <Tooltip label={help.tooltip} position='left' multiline maw={260}>
                    <ActionIcon
                      component={Link}
                      to={`/docs/${help.topic}`}
                      variant='subtle'
                      color='gray'
                      aria-label={help.tooltip}
                    >
                      <IconHelpCircle size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            )}
          </Group>
        </Card.Section>
      )}
      {flush ?
        <Card.Section className={`${classes.body} ${classes.flush}`}>{children}</Card.Section> :
        <div className={classes.body}>{children}</div>}
    </Card>
  )
}
