import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {AuthProviders} from '@/ui/AuthProviders'
import {SignInForm} from '@/features/auth/SignInForm'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <AuthProviders>
      <SignInForm mode='mock' />
    </AuthProviders>
  </StrictMode>
)
