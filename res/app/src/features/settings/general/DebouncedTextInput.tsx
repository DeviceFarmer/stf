import {useState} from 'react'
import {TextInput, type TextInputProps} from '@mantine/core'
import {useDebouncedCallback} from '@mantine/hooks'

export function DebouncedTextInput({value, onCommit, ...props}: Omit<TextInputProps, 'value' | 'onChange'> & {
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = useDebouncedCallback(onCommit, {delay: 400, flushOnUnmount: true})

  return (
    <TextInput
      {...props}
      value={draft === null ? value : draft}
      onChange={(event) => {
        setDraft(event.currentTarget.value)
        commit(event.currentTarget.value)
      }}
      onBlur={() => {
        commit.flush()
        setDraft(null)
      }}
    />
  )
}
