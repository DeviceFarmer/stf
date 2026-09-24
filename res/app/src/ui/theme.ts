import {createTheme, type MantineColorsTuple} from '@mantine/core'

const stf: MantineColorsTuple = [
  '#eef3ff'
  , '#dce4f5'
  , '#b9c7e2'
  , '#94a8d0'
  , '#748dc1'
  , '#5f7cb8'
  , '#5474b4'
  , '#44639f'
  , '#39588f'
  , '#2d4b81'
]

export const theme = createTheme({
  primaryColor: 'stf'
  , colors: {stf}
  , defaultRadius: 'md'
  , fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  , fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  , headings: {fontWeight: '600'}
  , cursorType: 'pointer'
  , components: {
    Button: {defaultProps: {variant: 'light'}}
    , Tooltip: {defaultProps: {withArrow: true, openDelay: 300}}
    , Card: {defaultProps: {withBorder: true, radius: 'lg'}}
    , Paper: {defaultProps: {radius: 'lg'}}
  }
})
