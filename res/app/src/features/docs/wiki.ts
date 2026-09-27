export const wikiHome = 'Help'

export function wikiUrl(document: string): string {
  return `/static/wiki/${encodeURIComponent(`[en]-${document}`)}`
}

export function documentName(path: string | undefined): string {
  const name = (path || '').replace(/\.md$/, '').replace(/^\/+|\/+$/g, '')
  return name || wikiHome
}

const wikiPrefix = '/static/wiki/'
const hashRoute = /^#!?(\/.*)$/

export function appRouteOf(href: string): string | null {
  if (href.startsWith('#')) {
    return hashRoute.exec(href)?.[1] || null
  }
  let url: URL
  try {
    url = new URL(href, `${window.location.origin}${wikiPrefix}`)
  }
  catch {
    return null
  }
  if (url.origin !== window.location.origin) {
    return null
  }
  const routed = hashRoute.exec(url.hash)
  if (routed && url.pathname === '/') {
    return routed[1]!
  }
  if (url.pathname.startsWith(wikiPrefix)) {
    const file = decodeURIComponent(url.pathname.slice(wikiPrefix.length)).replace(/^\[[\w-]+\]-/, '')
    return `/docs/${documentName(file)}`
  }
  return null
}

export function prepareFragment(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const root = parsed.querySelector('.stf-docs-content') || parsed.body
  root.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') || ''
    if (href.startsWith('#') && !hashRoute.test(href)) {
      return
    }
    const route = appRouteOf(href)
    if (route) {
      anchor.setAttribute('href', `#${route}`)
    }
    else {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
  })
  return root.innerHTML
}

export async function fetchDocument(document: string): Promise<string> {
  const response = await fetch(wikiUrl(document), {
    credentials: 'same-origin'
    , headers: {Accept: 'text/html'}
  })
  if (!response.ok || response.redirected) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return prepareFragment(await response.text())
}
