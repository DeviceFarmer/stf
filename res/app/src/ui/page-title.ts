import {useEffect} from 'react'

export function usePageTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `STF - ${title}` : 'STF'
    return () => {
      document.title = 'STF'
    }
  }, [title])
}
