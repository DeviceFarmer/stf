export class ApiError extends Error {
  readonly status: number
  readonly statusText: string
  readonly data: any

  constructor(status: number, statusText: string, data: any) {
    super(data?.description || `${status} ${statusText}`)
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
    this.data = data
  }
}

export function readCookie(name: string): string | null {
  const prefix = `${name}=`
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length))
    }
  }
  return null
}

export function csrfHeaders(): Record<string, string> {
  const token = readCookie('XSRF-TOKEN')
  return token ? {'X-XSRF-TOKEN': token} : {}
}

async function parseBody(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}

export async function request<T = any>(
  method: string
, url: string
, body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*'
    , ...csrfHeaders()
  }
  const init: RequestInit = {method, headers, credentials: 'same-origin'}

  if (typeof body !== 'undefined') {
    headers['Content-Type'] = 'application/json;charset=utf-8'
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const response = await fetch(url, init)
  const data = await parseBody(response)

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, data)
  }

  return data as T
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url)
  , post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body)
  , put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body)
  , delete: <T = any>(url: string, body?: unknown) => request<T>('DELETE', url, body)
}
