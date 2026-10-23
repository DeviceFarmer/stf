import {setTimeout as delay} from 'node:timers/promises'
import {runCommand, runJson} from './process.mts'
import type {WdaClient} from './wda.mts'

const assistive = 'com.apple.assistivetouchd'
interface Point {x: number, y: number}
interface Node {
  type: string
  name?: string
  label?: string
  isAccessible?: string | boolean
  isVisible?: string | boolean
  isEnabled?: string | boolean
  rect: {x: number, y: number, width: number, height: number}
  children?: Node[]
}

function nodes(node: Node): Node[] {
  return [node, ...(node.children || []).flatMap(nodes)]
}

function actionable(node: Node): boolean {
  return (node.type === 'Button' || (node.type === 'Other' &&
    (node.isAccessible === '1' || node.isAccessible === true))) &&
    node.isVisible !== '0' && node.isVisible !== false &&
    node.isEnabled !== '0' && node.isEnabled !== false
}

// Real-device UIKit motion events are provided by the system AssistiveTouch Shake action.
// No simulated accelerometer samples or application-specific debug endpoints are used.
export class AssistiveTouch {
  private location: Point | null = null
  private goIos: string
  private udid: string
  private json: typeof runJson
  private run: typeof runCommand

  constructor(goIos: string, udid: string, json = runJson, run = runCommand) {
    this.goIos = goIos
    this.udid = udid
    this.json = json
    this.run = run
  }

  async perform(wda: WdaClient, signal: AbortSignal, action: 'shake' | 'lock' = 'shake') {
    const errorPrefix = action === 'shake' ? 'IOS_SHAKE' : 'IOS_LOCK'
    const args = ['--udid=' + this.udid, 'assistivetouch']
    const original = await this.json(this.goIos, [...args, 'get'], 10000, signal) as
      {AssistiveTouchEnabled?: boolean}
    if (typeof original.AssistiveTouchEnabled !== 'boolean') {
      throw new Error(errorPrefix + '_UNAVAILABLE')
    }
    const {value: settings} = await wda.call('GET', '/appium/settings', undefined, signal)
    const {value: size} = await wda.call('GET', '/window/size', undefined, signal)
    if (!(size.width >= 200 && size.width <= 2000 && size.height >= 200 && size.height <= 2000)) {
      throw new Error(errorPrefix + '_UNAVAILABLE')
    }
    const configure = async(point: Point) => {
      await wda.call('POST', '/appium/settings', {settings: {
        defaultActiveApplication: assistive, activeAppDetectionPoint: point.x + ',' + point.y
      }}, signal)
    }
    const snapshot = async(point: Point): Promise<Node | null> => {
      await configure(point)
      const {value: active} = await wda.call('GET', '/wda/activeAppInfo', undefined, signal)
      if (active.bundleId !== assistive) {
        return null
      }
      const {value} = await wda.call('GET', '/source?format=json', undefined, signal)
      return value?.name === 'AssistiveTouch' ? value as Node : null
    }
    const locate = async(preferred: Point | null) => {
      const points = [...(preferred ? [preferred] : []), {x: size.width / 2, y: size.height / 2}]
      // Inspect points without tapping. The floating control docks against either vertical edge.
      for (let y = 30; y <= size.height - 30; y += 48) {
        points.push({x: size.width - 30, y}, {x: 30, y})
      }
      for (const point of points) {
        signal.throwIfAborted()
        const tree = await snapshot(point)
        if (tree) {
          return tree
        }
      }
      throw new Error(errorPrefix + '_UNAVAILABLE')
    }
    const tap = async(node: Node) => {
      signal.throwIfAborted()
      const r = node.rect
      if (!r || !Object.values(r).every(Number.isFinite) || r.width <= 0 || r.height <= 0 ||
          r.x < 0 || r.y < 0 || r.x + r.width > size.width || r.y + r.height > size.height) {
        throw new Error(errorPrefix + '_MENU_UNSUPPORTED')
      }
      // XCTest element.click does not reliably activate AssistiveTouch on physical iPhones.
      await wda.gesture({x: (r.x + r.width / 2) / (size.width - 1)
        , y: (r.y + r.height / 2) / (size.height - 1)}, null, 100, signal)
      await delay(600, null, {signal})
    }
    let success = false
    try {
      if (!original.AssistiveTouchEnabled) {
        await this.run(this.goIos, [...args, 'enable'], 10000, signal)
        await delay(1500, null, {signal})
      }
      let tree = await locate(this.location)
      const nub = nodes(tree).find(n => actionable(n) &&
        ['AssistiveTouch', 'AssistiveTouchNubbit'].includes(n.name || '') &&
        n.rect.width <= 100 && n.rect.height <= 100)
      if (nub) {
        this.location = {x: nub.rect.x + nub.rect.width / 2, y: nub.rect.y + nub.rect.height / 2}
        await tap(nub)
        tree = await locate({x: size.width / 2
          , y: Math.min(size.height - 170, Math.max(170, this.location.y))})
      }
      // Only known system actions are selected; unknown layouts/languages fail without tapping.
      const targetLabels = action === 'shake' ? ['Shake', 'Встряхивание', 'Встряхнуть'] :
        ['Lock Screen', 'Блокировка экрана', 'Заблокировать экран']
      const actions = [['Device', 'Устройство']
        , ...(action === 'shake' ? [['More', 'Еще', 'Ещё']] : []), targetLabels]
      const targetIcon = action === 'shake' ? 'axaction.device.shake_DI' : 'axaction.device.lock_DI'
      for (const labels of actions) {
        const buttons = nodes(tree).filter(actionable)
        const target = [...buttons].reverse().find(n =>
          nodes(n).some(c => c.name === targetIcon))
        const button = target || buttons.find(n => labels.includes(n.name || n.label || ''))
        if (!button) {
          throw new Error(errorPrefix + '_MENU_UNSUPPORTED')
        }
        await tap(button)
        if (target || labels === targetLabels) {
          success = true
          break
        }
        tree = await locate({x: size.width / 2, y: button.rect.y})
      }
    }
    finally {
      // Cleanup has its own bounded calls even if the owner's request was cancelled.
      try {
        await wda.call('POST', '/appium/settings', {settings: {
          defaultActiveApplication: settings.defaultActiveApplication
          , activeAppDetectionPoint: settings.activeAppDetectionPoint
        }})
      }
      finally {
        if (!original.AssistiveTouchEnabled || !success) {
          await this.run(this.goIos, [...args, 'disable'], 10000)
        }
        if (original.AssistiveTouchEnabled && !success) {
          await this.run(this.goIos, [...args, 'enable'], 10000)
        }
      }
    }
  }
}
