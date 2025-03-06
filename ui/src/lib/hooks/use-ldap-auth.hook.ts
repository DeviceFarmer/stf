import { useMutation } from '@tanstack/react-query'

import { ldapAuth } from '@/api/auth'

import type { AxiosError } from 'axios'
import type { AuthResponse, LdapAuthArgs } from '@/api/auth/types'
import type { UseMutationResult } from '@tanstack/react-query'
import type { AuthErrorResponse } from '@/types/auth-error-response.type'

export const useLdapAuth = (): UseMutationResult<AuthResponse, AxiosError<AuthErrorResponse>, LdapAuthArgs> =>
  useMutation({
    mutationFn: (data) => ldapAuth(data),
  })
