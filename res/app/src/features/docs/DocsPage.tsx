import {useEffect, useRef, type MouseEvent} from 'react'
import {useLocation, useNavigate, useParams} from 'react-router'
import {ActionIcon, Button, Center, Group, Loader, Paper, Text, Tooltip, Typography} from '@mantine/core'
import {IconChevronLeft, IconFileUnknown, IconHome} from '@tabler/icons-react'
import {useQuery} from '@tanstack/react-query'
import {useTranslation} from '@/core/i18n'
import {NothingToShow} from '@/ui/NothingToShow'
import {Page} from '@/ui/Page'
import {usePageTitle} from '@/ui/page-title'
import {documentName, fetchDocument, wikiHome} from './wiki'
import classes from './DocsPage.module.css'

const homeRoute = `/docs/${wikiHome}`

function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export default function DocsPage() {
  const {t} = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const docName = location.pathname === '/help' ? wikiHome : documentName(params['*'])
  const hasHistory = window.history.length > 1
  const pageRef = useRef<HTMLDivElement>(null)

  usePageTitle(t('Help'))

  const {data, isPending, isError} = useQuery({
    queryKey: ['docs', docName]
    , queryFn: () => fetchDocument(docName)
    , retry: false
    , staleTime: Infinity
  })

  useEffect(() => {
    pageRef.current?.scrollTo({top: 0})
  }, [docName])

  function onContentClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href || !href.startsWith('#') || !isPlainClick(event)) {
      return
    }
    event.preventDefault()
    if (href.startsWith('#/')) {
      navigate(href.slice(1))
      return
    }
    const target = event.currentTarget.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)
    target?.scrollIntoView({behavior: 'smooth', block: 'start'})
  }

  function renderContent() {
    if (isPending) {
      return <Center py='xl'><Loader /></Center>
    }
    if (isError) {
      return (
        <NothingToShow icon={<IconFileUnknown size={30} />} message={t('Not Found')}>
          <Button leftSection={<IconHome size={16} />} onClick={() => navigate(homeRoute)}>
            {t('Home')}
          </Button>
        </NothingToShow>
      )
    }
    return (
      <Typography
        className={`${classes.content} selectable`}
        onClick={onContentClick}
        dangerouslySetInnerHTML={{__html: data}}
      />
    )
  }

  return (
    <Page ref={pageRef} className='stf-docs' innerClassName={classes.inner} maxWidth={960}>
      <Group className={`${classes.toolbar} stf-docs-navigation`} justify='space-between' wrap='nowrap'>
        <Group gap='xs' wrap='nowrap'>
          {hasHistory && (
            <Tooltip label={t('Go Back')}>
              <ActionIcon
                variant='default'
                size='lg'
                className='docs-back'
                aria-label={t('Go Back')}
                onClick={() => navigate(-1)}
              >
                <IconChevronLeft size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t('Home')}>
            <ActionIcon
              variant='default'
              size='lg'
              className='docs-home'
              aria-label={t('Home')}
              onClick={() => navigate(homeRoute)}
            >
              <IconHome size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Text size='sm' c='dimmed' truncate>
          {t('Help')} / {docName.replace(/-/g, ' ')}
        </Text>
      </Group>
      <Paper withBorder shadow='xs' className={classes.paper}>
        {renderContent()}
      </Paper>
    </Page>
  )
}
