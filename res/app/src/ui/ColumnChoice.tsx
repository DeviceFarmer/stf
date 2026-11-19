import {useState} from 'react'
import {ActionIcon, Button, Checkbox, Group, Popover, Tooltip, type PopoverProps} from '@mantine/core'
import {IconColumns, IconGripVertical, IconTrash} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import classes from './ColumnChoice.module.css'

export interface ColumnChoiceItem {
  id: string
  label: string
  selected: boolean
}

const multiColumnThreshold = 12

export function ColumnChoice({items, onChange, onReset, reorderable, compact, position = 'bottom-start', popover}: {
  items: ColumnChoiceItem[]
  onChange: (items: ColumnChoiceItem[]) => void
  onReset: () => void
  reorderable?: boolean
  compact?: boolean
  position?: PopoverProps['position']
  popover?: {
    opened: boolean
    onChange: (opened: boolean) => void
    duration: number
  }
}) {
  const {t} = useTranslation()
  const [dragged, setDragged] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)

  function toggle(index: number) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? {...item, selected: !item.selected} : item)))
  }

  function endDrag() {
    setDragged(null)
    setTarget(null)
  }

  function drop(index: number) {
    if (dragged !== null && dragged !== index) {
      const next = items.slice()
      const [moved] = next.splice(dragged, 1)
      next.splice(index, 0, moved!)
      onChange(next)
    }
    endDrag()
  }

  const togglePopover = popover && (() => popover.onChange(!popover.opened))
  const popoverProps: PopoverProps | undefined = popover && {
    opened: popover.opened
    , onChange: popover.onChange
    , onClose: endDrag
    // Preserve the dropdown position during exit when the trigger is hidden.
    , keepMounted: true
    , hideDetached: popover.opened
    , transitionProps: {transition: 'fade', duration: popover.duration}
  }

  const trigger = compact ? (
    <Tooltip label={t('Customize')}>
      <ActionIcon
        variant='default'
        size='md'
        aria-label={t('Customize')}
        className='stf-column-choice'
        onClick={togglePopover}
      >
        <IconColumns size={16} />
      </ActionIcon>
    </Tooltip>
  ) : (
    <Button
      size='xs'
      variant='default'
      leftSection={<IconColumns size={16} />}
      className='stf-column-choice'
      onClick={togglePopover}
    >
      {t('Customize')}
    </Button>
  )

  return (
    <Popover position={position} shadow='md' withinPortal {...popoverProps}>
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown className='stf-column-customize' inert={popover?.opened === false}>
        <div className={classes.list} data-columns={items.length > multiColumnThreshold || undefined}>
          {items.map((item, index) => (
            <div
              key={item.id}
              draggable={reorderable}
              className={`${classes.item} ${target === index ? classes.target : ''}`}
              onDragStart={reorderable ? (event) => {
                event.dataTransfer.effectAllowed = 'move'
                setDragged(index)
              } : undefined}
              onDragOver={reorderable ? (event) => {
                event.preventDefault()
                setTarget(index)
              } : undefined}
              onDragLeave={reorderable ? () => setTarget(null) : undefined}
              onDrop={reorderable ? () => drop(index) : undefined}
              onDragEnd={reorderable ? endDrag : undefined}
            >
              {reorderable && <IconGripVertical size={14} className={classes.grip} />}
              <Checkbox size='xs' label={item.label} checked={item.selected} onChange={() => toggle(index)} />
            </div>
          ))}
        </div>
        <Group justify='flex-end' mt='sm'>
          <Button size='xs' color='red' variant='light' leftSection={<IconTrash size={14} />} onClick={onReset}>
            {t('Reset')}
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  )
}
