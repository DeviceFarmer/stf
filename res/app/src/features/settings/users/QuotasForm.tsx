import {useState} from 'react'
import {Button, Group, NumberInput, SimpleGrid, Tooltip} from '@mantine/core'
import {getDuration} from '@/core/common'
import {gettext, useTranslation} from '@/core/i18n'

export interface QuotaValues {
  number: number
  duration: number
  repetitions: number
}

type Draft = Record<keyof QuotaValues, number | string>

function isQuota(value: number | string): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function reasonOf(draft: Draft, initial: QuotaValues): string {
  if (!isQuota(draft.number) || !isQuota(draft.duration) || !isQuota(draft.repetitions)) {
    return gettext('Bad syntax')
  }
  if (draft.number === initial.number && draft.duration === initial.duration &&
      draft.repetitions === initial.repetitions) {
    return gettext('No change')
  }
  return ''
}

export function QuotasForm({initial, onSave, className}: {
  initial: QuotaValues
  onSave: (values: QuotaValues) => Promise<unknown>
  className?: string
}) {
  const {t} = useTranslation()
  const [draft, setDraft] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const reason = reasonOf(draft, initial)

  async function save() {
    setSaving(true)
    try {
      await onSave(draft as QuotaValues)
    }
    finally {
      setSaving(false)
    }
  }

  return (
    <div className={className}>
      <SimpleGrid cols={{base: 1, sm: 3}} spacing='sm'>
        <NumberInput
          size='xs'
          label={t('Number of groups')}
          name='groupsNumber'
          min={0}
          allowDecimal={false}
          allowNegative={false}
          required
          value={draft.number}
          error={isQuota(draft.number) ? null : true}
          onChange={(number) => setDraft({...draft, number})}
        />
        <NumberInput
          size='xs'
          label={t('Total duration of groups (ms)')}
          name='groupsDuration'
          min={0}
          allowDecimal={false}
          allowNegative={false}
          required
          value={draft.duration}
          description={isQuota(draft.duration) ? getDuration(draft.duration) : null}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          error={isQuota(draft.duration) ? null : true}
          onChange={(duration) => setDraft({...draft, duration})}
        />
        <NumberInput
          size='xs'
          label={t('Number of repetitions per group')}
          name='groupsRepetitions'
          min={0}
          allowDecimal={false}
          allowNegative={false}
          required
          value={draft.repetitions}
          error={isQuota(draft.repetitions) ? null : true}
          onChange={(repetitions) => setDraft({...draft, repetitions})}
        />
      </SimpleGrid>
      <Group mt='sm'>
        <Tooltip label={t(reason)} disabled={!reason}>
          <span>
            <Button size='xs' variant='filled' disabled={Boolean(reason) || saving} loading={saving} onClick={save}>
              {t('Save')}
            </Button>
          </span>
        </Tooltip>
      </Group>
    </div>
  )
}
