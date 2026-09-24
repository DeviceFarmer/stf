import type {ReactNode} from 'react'
import {Text, ThemeIcon} from '@mantine/core'
import classes from './SettingRow.module.css'

export function SettingRow({icon, label, description, stacked, className, children}: {
  icon?: ReactNode
  label: ReactNode
  description?: ReactNode
  stacked?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div className={[classes.row, stacked && classes.stacked, className].filter(Boolean).join(' ')}>
      <div className={classes.rowLead}>
        {icon && <ThemeIcon variant='light' color='gray' radius='md' size={36}>{icon}</ThemeIcon>}
        <div>
          <Text size='sm' fw={500}>{label}</Text>
          {description && <Text size='xs' c='dimmed'>{description}</Text>}
        </div>
      </div>
      <div className={classes.rowControl}>{children}</div>
    </div>
  )
}
