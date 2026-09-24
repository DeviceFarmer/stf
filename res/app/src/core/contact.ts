import {useEffect, useState} from 'react'
import {api} from './api'

export function useContactEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    api.get<{contact: {email: string}}>('/auth/contact')
      .then((response) => setEmail(response.contact.email))
      .catch(() => undefined)
  }, [])

  return email
}
