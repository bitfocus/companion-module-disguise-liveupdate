import { SomeCompanionConfigField, Regex } from '@companion-module/base'

export interface DisguiseConfig {
  host: string
  port: number
  reconnectInterval?: number
  pendingSubscriptionTimeout?: number
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
    {
      type: 'static-text',
      id: 'usageInfo',
      label: 'How to Use',
      width: 12,
      value: `<strong>This module uses Feedbacks to subscribe to Disguise properties.</strong><br><br>
<strong>To monitor Disguise properties:</strong><br>
1. Add the "Subscribe to Disguise Property" <strong>feedback</strong> to a button<br>
2. Configure the feedback with a variable name and Disguise object/property paths<br>
3. The module will create a variable (e.g. \$(liveupdate:fps)) that updates continuously<br>
4. Use Companion's expression variables to compare values and create visual feedback<br>
5. Use the variable anywhere in Companion (buttons, text, triggers, other modules)<br><br>
<strong>To set Disguise properties:</strong><br>
Use the "Set to Disguise" <strong>actions</strong> to write variable values back to Disguise<br><br>
<strong>Example:</strong><br>
• Add "Subscribe to Disguise Property" feedback to a button:<br>
&nbsp;&nbsp;- Variable Name: <code>fps</code><br>
&nbsp;&nbsp;- Object: <code>subsystem:MonitoringManager.findLocalMonitor("fps")</code><br>
&nbsp;&nbsp;- Property: <code>object.seriesAverage("Actual", 1)</code><br>
• Use expression variable <code>\$(liveupdate:fps) &lt; 30</code> for visual feedback<br>
• No comparison feedbacks needed - use Companion's expression system instead!`,
    },
  ]
}
