import {useState} from 'react'
import {ActionIcon, Tooltip} from '@mantine/core'
import {useTimeout} from '@mantine/hooks'
import {IconCheck, IconCopy} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {copyToClipboard} from './clipboard'
import {notifyFailure} from './notify'

export function CopyButton({value, onCopied, className, variant = 'subtle', size = 'md'}: {
  value: string
  onCopied?: () => void
  className?: string
  variant?: 'subtle' | 'light'
  size?: 'md' | 'lg'
}) {
  const {t} = useTranslation()
  const [copied, setCopied] = useState(false)
  const reset = useTimeout(() => setCopied(false), 1500)
  const iconSize = size === 'lg' ? 18 : 16

  function copy() {
    copyToClipboard(value).then(() => {
      setCopied(true)
      reset.start()
      onCopied?.()
    }, notifyFailure)
  }

  return (
    <Tooltip label={copied ? t('Copied') : t('Copy to clipboard')}>
      <ActionIcon
        className={className}
        variant={variant}
        size={size}
        color={copied ? 'teal' : 'gray'}
        disabled={!value}
        onClick={copy}
        aria-label={t('Copy to clipboard')}
      >
        {copied ? <IconCheck size={iconSize} /> : <IconCopy size={iconSize} />}
      </ActionIcon>
    </Tooltip>
  )
}
