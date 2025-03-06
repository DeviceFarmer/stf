import axios from 'axios'

import { variablesConfig } from '@/config/variables.config'

import { attachTokenOnRequest, logoutOnErrorResponse } from '../interceptor'

export const openstfApiClient = axios.create({
  baseURL: `${variablesConfig[import.meta.env.MODE].openStfApiHostUrl}/api/v1`,
  withCredentials: true,
})

openstfApiClient.interceptors.request.use((config) => attachTokenOnRequest(config))
openstfApiClient.interceptors.response.use((response) => response, logoutOnErrorResponse)
