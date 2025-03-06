import { useMutation } from '@tanstack/react-query'

import { mockAuth } from '@/api/auth'

import type { AxiosError } from 'axios'
import type { AuthResponse, MockAuthArgs } from '@/api/auth/types'
import type { UseMutationResult } from '@tanstack/react-query'
import type { AuthErrorResponse } from '@/types/auth-error-response.type'

export const useMockAuth = (): UseMutationResult<AuthResponse, AxiosError<AuthErrorResponse>, MockAuthArgs> =>
  useMutation({
    mutationFn: (data) => mockAuth(data),
  })
