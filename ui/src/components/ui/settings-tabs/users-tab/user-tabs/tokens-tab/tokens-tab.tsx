import { List, Placeholder, Spinner } from '@vkontakte/vkui'
import { useTranslation } from 'react-i18next'
import { observer } from 'mobx-react-lite'
import { Icon28InboxOutline } from '@vkontakte/icons'

import { ListItem } from '@/components/lib/list-item'

import styles from '../../users-tab.module.css'

type UserGeneralTabProps = {
  tokens: string[]
  isLoading?: boolean
  onRemove: (tokenId: string) => void
}

export const TokensTab = observer(({ tokens, isLoading = false, onRemove }: UserGeneralTabProps) => {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
        <Spinner size='m' />
      </div>
    )
  }

  return (
    <List className={styles.tokenList} gap={12}>
      {tokens.length === 0 ? (
        <Placeholder className={styles.noTokens} icon={<Icon28InboxOutline />}>
          {t('Empty')}
        </Placeholder>
      ) : (
        tokens.map((token) => (
          <ListItem
            key={token}
            isNeedConfirmRemove={true}
            modalDescription={t('Are you sure you want to delete the access token')}
            title={token}
            onRemove={() => onRemove(token)}
          />
        ))
      )}
    </List>
  )
})
