import { SomeCompanionConfigField, Regex } from '@companion-module/base'

export interface DisguiseConfig {
  host: string
  port: number
  reconnectInterval?: number
  pendingSubscriptionTimeout?: number
  savedAutoSubscriptions?: string // Hidden field - auto-managed by button auto-subscribe checkboxes
}

export function getConfigFields(): SomeCompanionConfigField[] {
  return [
    {
      type: 'static-text',
      id: 'info',
      label: 'Connection Settings',
      width: 12,
      value: 'Configure connection to Disguise Designer Director (LiveUpdate API)',
    },
    {
      type: 'textinput',
      id: 'host',
      label: 'Director IP Address',
      width: 6,
      default: '127.0.0.1',
      regex: Regex.HOSTNAME,
    },
    {
      type: 'number',
      id: 'port',
      label: 'Port',
      width: 3,
      default: 80,
      min: 1,
      max: 65535,
    },
    {
      type: 'number',
      id: 'reconnectInterval',
      label: 'Reconnect Interval (ms)',
      width: 3,
      default: 5000,
      min: 1000,
      max: 60000,
      step: 1000,
    },
    {
        type: 'number',
        id: 'pendingSubscriptionTimeout',
        label: 'Pending Subscription Timeout (ms)',
        width: 6,
        default: 30000,
        min: 5000,
        max: 300000,
        step: 5000,
    },
  ]
}
