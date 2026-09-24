import {api, ApiError, csrfHeaders} from './api'

export interface UploadProgress {
  loaded: number
  total: number
}

export function storeUrl<T = any>(type: string, url: string): Promise<T> {
  return api.post<T>(`/s/download/${type}`, {url})
}

export function storeFiles<T = any>(
  type: string
, files: File[]
, options: {filter?: (file: File) => boolean, onProgress?: (progress: UploadProgress) => void} = {}
): Promise<T> {
  const input = options.filter ? files.filter(options.filter) : files

  if (!input.length) {
    const error = new Error('No input files') as Error & {code: string}
    error.code = 'no_input_files'
    return Promise.reject(error)
  }

  const form = new FormData()
  input.forEach((file) => form.append('file', file))

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/s/upload/${type}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    for (const [name, value] of Object.entries(csrfHeaders())) {
      xhr.setRequestHeader(name, value)
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.({
          loaded: event.loaded
          , total: event.total
        })
      }
    }
    xhr.onload = () => {
      let data: any = xhr.responseText
      try {
        data = JSON.parse(xhr.responseText)
      }
      catch {
        data = xhr.responseText
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T)
      }
      else {
        reject(new ApiError(xhr.status, xhr.statusText, data))
      }
    }
    xhr.onerror = () => reject(new ApiError(xhr.status, xhr.statusText, null))
    xhr.send(form)
  })
}
