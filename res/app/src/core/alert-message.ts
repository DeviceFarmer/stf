export interface AlertMessage {
  data: string
  activation: string
  level: string
}

export const alertLevelColors: Record<string, string> = {
  Information: 'blue'
  , Warning: 'yellow'
  , Critical: 'red'
}
