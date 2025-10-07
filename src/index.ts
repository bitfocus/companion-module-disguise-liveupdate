import {
  InstanceBase,
  InstanceStatus,
  Regex,
  runEntrypoint,
} from '@companion-module/base'
import WebSocket from 'ws'
import { getConfigFields, DisguiseConfig } from './config'
import { getActionDefinitions } from './actions'
import { getFeedbackDefinitions } from './feedbacks'
import { getPresetDefinitions } from './presets'
import { getVariableDefinitions } from './variables'
import { upgradeScripts } from './upgrades'

/**
 * Represents a subscription in the LiveUpdate API
 */
export interface LiveUpdateSubscription {
  id: number
  objectPath: string
  propertyPath: string
  customVariableName?: string
  value?: any
  changeTimestamp?: number
  messageTimestamp?: number
}

/**
 * Disguise Designer module instance with LiveUpdate API support
 */
export class DisguiseInstance extends InstanceBase<DisguiseConfig> {
  public config!: DisguiseConfig
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | undefined
  private autoSubscribeTimer: NodeJS.Timeout | undefined
  private pendingCleanupTimer: NodeJS.Timeout | undefined
  private subscriptions: Map<number, LiveUpdateSubscription> = new Map()
  private pendingSubscriptions: Map<string, { variableName: string; timestamp: number }> = new Map() // Map of "objectPath:propertyPath" -> { variableName, timestamp }
  private connectionReady = false
  private shouldReconnect = false
  private managedCustomVariables: Set<string> = new Set()
  private customVariables: Map<string, any> = new Map()
  private autoSubscribeList: Array<{objectPath: string, propertyPath: string, variableName?: string, updateFrequency?: number}> = []

  async init(config: DisguiseConfig): Promise<void> {
    this.log('debug', 'Initializing Disguise Designer LiveUpdate module')
    this.updateStatus(InstanceStatus.Disconnected)
    await this.applyConfig(config)
  }

  async destroy(): Promise<void> {
    this.shouldReconnect = false
    this.connectionReady = false
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    
    if (this.autoSubscribeTimer) {
      clearTimeout(this.autoSubscribeTimer)
      this.autoSubscribeTimer = undefined
    }
    
    if (this.pendingCleanupTimer) {
      clearTimeout(this.pendingCleanupTimer)
      this.pendingCleanupTimer = undefined
    }
    
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    
    this.subscriptions.clear()
    this.pendingSubscriptions.clear()
    this.managedCustomVariables.clear()
    this.customVariables.clear()
  }

  async configUpdated(config: DisguiseConfig): Promise<void> {
    this.shouldReconnect = false
    this.disconnect()
    await this.applyConfig(config)
  }

  getConfigFields() {
    return getConfigFields()
  }

  getUpgradeScripts() {
    return upgradeScripts
  }

  setupActions(): void {
    this.setActionDefinitions(getActionDefinitions(this))
  }

  setupFeedbacks(): void {
    this.setFeedbackDefinitions(getFeedbackDefinitions(this))
  }

  setupVariables(): void {
    this.setVariableDefinitions(getVariableDefinitions())
  }

  setupPresets(): void {
    this.setPresetDefinitions(getPresetDefinitions(this))
  }

  isConnectionReady(): boolean {
    return this.connectionReady
  }

  /**
   * Get the current value of a subscription by ID
   */
  getSubscriptionValue(id: number): any {
    return this.subscriptions.get(id)?.value
  }

  /**
   * Get the current value of a custom variable
   */
  getCustomVariableValue(name: string): any {
    return this.customVariables.get(name)
  }

  /**
   * Get all current subscriptions
   */
  getSubscriptions(): Map<number, LiveUpdateSubscription> {
    return this.subscriptions
  }

  private send(message: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message))
        return true
      } catch (error) {
        this.log('error', `Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
        // Connection might be closing or in a bad state, trigger reconnect
        this.disconnect()
        this.scheduleReconnect()
        return false
      }
    } else {
      this.log('warn', 'Cannot send message - WebSocket not connected')
      return false
    }
  }

  /**
   * Subscribe to a LiveUpdate property
   * Note: When subscribing to multiple properties, only the first property will be used for custom variable naming
   */
  subscribe(objectPath: string, properties: string[], customVariableName?: string, updateFrequencyMs?: number, autoSubscribe?: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot subscribe - WebSocket not connected')
      return
    }

    if (!properties || properties.length === 0) {
      this.log('warn', 'Cannot subscribe - No properties specified')
      return
    }

    const message: any = {
      subscribe: {
        object: objectPath,
        properties: properties,
      },
    }

    if (updateFrequencyMs !== undefined) {
      message.subscribe.configuration = { updateFrequencyMs }
    }

    this.log('debug', `Subscribing to ${objectPath}: ${properties.join(', ')}`)
    
    if (!this.send(message)) {
      return
    }
    
    // Store the custom variable name for when we get the subscription ID back
    // Note: If multiple properties are subscribed, only the first one is tracked for custom naming
    if (customVariableName) {
      if (properties.length > 1) {
        this.log('warn', `Custom variable name "${customVariableName}" will only track the first property: ${properties[0]}`)
      }
      
      const key = `${objectPath}:${properties[0]}`
      this.pendingSubscriptions.set(key, { variableName: customVariableName, timestamp: Date.now() })
      
      // Track this custom variable for management (always, regardless of autoSubscribe)
      this.managedCustomVariables.add(customVariableName)
      
      // Set initial placeholder value - definition will be added when subscription is confirmed
      this.setVariableValues({ [customVariableName]: '...' })
    }
    
    // Add to auto-subscribe list if requested (only when manually triggered)
    if (autoSubscribe) {
      // Check if already in list (avoid duplicates)
      const existing = this.autoSubscribeList.findIndex(
        sub => sub.objectPath === objectPath && sub.propertyPath === properties[0]
      )
      
      if (existing >= 0) {
        // Update existing entry
        this.autoSubscribeList[existing] = {
          objectPath,
          propertyPath: properties[0],
          variableName: customVariableName,
          updateFrequency: updateFrequencyMs
        }
      } else {
        // Add new entry
        this.autoSubscribeList.push({
          objectPath,
          propertyPath: properties[0],
          variableName: customVariableName,
          updateFrequency: updateFrequencyMs
        })
      }
      
      this.log('info', `Added to auto-subscribe list: ${objectPath}.${properties[0]}`)
      
      // Save the updated list to config
      this.saveAutoSubscribeList()
    }
  }

  /**
   * Load auto-subscribe list from saved configuration
   */
  private loadAutoSubscribeList(): void {
    if (this.config.savedAutoSubscriptions) {
      try {
        const parsed = JSON.parse(this.config.savedAutoSubscriptions)
        if (Array.isArray(parsed)) {
          this.autoSubscribeList = parsed
          
          // Rebuild managedCustomVariables from saved subscriptions
          this.autoSubscribeList.forEach(sub => {
            if (sub.variableName) {
              this.managedCustomVariables.add(sub.variableName)
              this.log('info', `Restored managed custom variable: ${sub.variableName}`)
            }
          })
          
          this.log('info', `Loaded ${this.autoSubscribeList.length} auto-subscriptions from config`)
        }
      } catch (error) {
        this.log('error', `Failed to parse saved auto-subscriptions: ${error instanceof Error ? error.message : String(error)}`)
        this.autoSubscribeList = []
      }
    }
  }

  /**
   * Save auto-subscribe list to configuration
   */
  private saveAutoSubscribeList(): void {
    try {
      const serialized = JSON.stringify(this.autoSubscribeList)
      this.config.savedAutoSubscriptions = serialized
      // Update the config to persist it
      this.saveConfig(this.config, undefined)
      this.log('info', `Saved ${this.autoSubscribeList.length} auto-subscriptions to config`)
    } catch (error) {
      this.log('error', `Failed to save auto-subscriptions: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Unsubscribe from a LiveUpdate property by ID
   */
  unsubscribe(id: number, removeFromAutoSubscribe?: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot unsubscribe - WebSocket not connected')
      return
    }

    if (!this.subscriptions.has(id)) {
      this.log('warn', `Subscription ID ${id} does not exist`)
      return
    }

    // Get subscription details before removing
    const subscription = this.subscriptions.get(id)
    
    const message = {
      unsubscribe: { id },
    }

    this.log('debug', `Unsubscribing from subscription ID: ${id}`)
    
    this.send(message)
    
    // Remove from auto-subscribe list if requested
    if (removeFromAutoSubscribe && subscription) {
      const index = this.autoSubscribeList.findIndex(
        sub => sub.objectPath === subscription.objectPath && sub.propertyPath === subscription.propertyPath
      )
      
      if (index >= 0) {
        this.autoSubscribeList.splice(index, 1)
        this.log('info', `Removed from auto-subscribe list: ${subscription.objectPath}.${subscription.propertyPath}`)
        
        // Save the updated list to config
        this.saveAutoSubscribeList()
      }
    }
  }

  /**
   * Set a LiveUpdate property value
   */
  setProperty(id: number, value: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot set property - WebSocket not connected')
      return
    }

    if (!this.subscriptions.has(id)) {
      this.log('warn', `Subscription ID ${id} does not exist`)
      return
    }

    const message = {
      set: [{ id, value }],
    }

    this.log('debug', `Setting property ID ${id} to: ${JSON.stringify(value)}`)
    
    this.send(message)
  }

  private async applyConfig(config: DisguiseConfig): Promise<void> {
    this.config = config
    
    // Load saved auto-subscriptions from config
    this.loadAutoSubscribeList()

    if (!config.host) {
      this.updateStatus(InstanceStatus.BadConfig, 'Host or IP required')
      return
    }

    this.setupActions()
    this.setupFeedbacks()
    this.setupVariables()
    this.setupPresets()
    
    this.shouldReconnect = true
    this.connect()
  }

  private connect(): void {
    if (this.ws) {
      this.disconnect()
    }

    const url = `ws://${this.config.host}:${this.config.port}/api/session/liveupdate`
    this.log('info', `Connecting to Disguise Designer at ${url}`)
    this.updateStatus(InstanceStatus.Connecting)

    try {
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        this.log('info', 'Connected to Disguise Designer LiveUpdate API')
        this.updateStatus(InstanceStatus.Ok)
        this.connectionReady = true
        this.stopReconnectTimer()
        this.setVariableValues({
          connection_status: 'Connected',
        })
        
        // Auto-subscribe to saved subscriptions (from button auto-subscribe checkboxes)
        this.autoSubscribeTimer = setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.log('info', `Restoring ${this.autoSubscribeList.length} saved auto-subscriptions`)
            for (const sub of this.autoSubscribeList) {
              this.log('debug', `Auto-subscribing to ${sub.objectPath}.${sub.propertyPath}`)
              this.subscribe(
                sub.objectPath,
                [sub.propertyPath],
                sub.variableName,
                sub.updateFrequency,
                false // Don't re-add to list
              )
            }
          }
        }, 500)
        
        // Start periodic cleanup of pending subscriptions
        this.startPendingCleanupTimer()
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('error', (error: Error) => {
        this.log('error', `WebSocket error: ${error.message}`)
        this.updateStatus(InstanceStatus.ConnectionFailure, error.message)
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason ? reason.toString() : ''
        this.log('warn', `WebSocket closed: ${code} ${reasonStr}`)
        this.connectionReady = false
        this.subscriptions.clear()
        this.setVariableValues({
          connection_status: 'Disconnected',
        })
        
        // Clear timers on disconnect
        if (this.autoSubscribeTimer) {
          clearTimeout(this.autoSubscribeTimer)
          this.autoSubscribeTimer = undefined
        }
        if (this.pendingCleanupTimer) {
          clearTimeout(this.pendingCleanupTimer)
          this.pendingCleanupTimer = undefined
        }
        
        if (this.shouldReconnect) {
          this.updateStatus(InstanceStatus.Disconnected, 'Connection lost')
          this.scheduleReconnect()
        } else {
          this.updateStatus(InstanceStatus.Disconnected)
        }
      })
    } catch (error) {
      this.log('error', `Failed to create WebSocket: ${error}`)
      this.updateStatus(InstanceStatus.ConnectionFailure)
      this.scheduleReconnect()
    }
  }

  private disconnect(): void {
    this.stopReconnectTimer() // This will clear reconnectTimer
    
    if (this.autoSubscribeTimer) {
      clearTimeout(this.autoSubscribeTimer)
      this.autoSubscribeTimer = undefined
    }
    
    if (this.pendingCleanupTimer) {
      clearTimeout(this.pendingCleanupTimer)
      this.pendingCleanupTimer = undefined
    }
    
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close()
        }
      } catch (error) {
        // Ignore close errors
      }
      this.ws = null
    }
    this.subscriptions.clear()
    this.pendingSubscriptions.clear()
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    
    this.stopReconnectTimer()
    const interval = this.config.reconnectInterval ?? 5000
    this.log('info', `Reconnecting in ${interval}ms`)
    
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, interval)
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data)

      if (message.error) {
        this.log('error', `LiveUpdate error: ${message.error}`)
        return
      }

      if (message.subscriptions) {
        this.handleSubscriptionsUpdate(message.subscriptions)
      }

      if (message.valuesChanged) {
        this.handleValuesChanged(message.valuesChanged)
      }
    } catch (error) {
      this.log('error', `Failed to parse message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private handleSubscriptionsUpdate(subscriptions: any[]): void {
    this.log('debug', `Subscriptions updated: ${subscriptions.length} active`)
    this.log('debug', `Pending subscriptions: ${this.pendingSubscriptions.size}`)
    
    // Update our subscription map
    const newSubscriptions = new Map<number, LiveUpdateSubscription>()
    for (const sub of subscriptions) {
      const existing = this.subscriptions.get(sub.id)
      let customVariableName = existing?.customVariableName
      
      // Check if this matches any pending subscription
      const key = `${sub.objectPath}:${sub.propertyPath}`
      if (this.pendingSubscriptions.has(key)) {
        const pending = this.pendingSubscriptions.get(key)
        customVariableName = pending?.variableName
        this.log('info', `Matched pending subscription: ${key} -> ${customVariableName}`)
        this.pendingSubscriptions.delete(key)
      } else if (!existing) {
        this.log('debug', `No pending match for new subscription: ${key}`)
      }
      
      newSubscriptions.set(sub.id, {
        id: sub.id,
        objectPath: sub.objectPath,
        propertyPath: sub.propertyPath,
        customVariableName: customVariableName,
        value: existing?.value, // Preserve existing value
        changeTimestamp: existing?.changeTimestamp,
        messageTimestamp: existing?.messageTimestamp,
      })
      
      if (customVariableName) {
        this.log('info', `Subscription ${sub.id}: ${sub.objectPath}.${sub.propertyPath} -> variable: ${customVariableName}`)
      }
    }
    this.subscriptions = newSubscriptions

    // Update custom variables cache
    this.updateCustomVariablesCache()

    // Update feedbacks and variables
    this.checkFeedbacks()
    this.updateVariableDefinitions()
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return ''
    }
    
    if (typeof value === 'number') {
      // Show integers without decimals, floats with appropriate precision
      return Number.isInteger(value) ? value.toString() : value.toFixed(2)
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    
    return String(value)
  }

  private handleValuesChanged(values: any[]): void {
    const changedVars: Record<string, any> = {}
    
    for (const valueUpdate of values) {
      const subscription = this.subscriptions.get(valueUpdate.id)
      if (subscription) {
        subscription.value = valueUpdate.value
        subscription.changeTimestamp = valueUpdate.changeTimestamp
        subscription.messageTimestamp = valueUpdate.messageTimestamp

        const valueStr = this.formatValue(valueUpdate.value)
        this.log('debug', `Value changed for ${subscription.objectPath}.${subscription.propertyPath}: ${valueStr}`)
        
        // Keep primitives (number, string, boolean) as-is for Companion expressions
        // Convert complex objects (arrays, objects) to JSON strings for display
        let displayValue = valueUpdate.value
        if (valueUpdate.value !== null && valueUpdate.value !== undefined) {
          const valueType = typeof valueUpdate.value
          if (valueType === 'object') {
            // Arrays and objects need to be stringified
            displayValue = JSON.stringify(valueUpdate.value)
          }
          // else: number, string, boolean stay as-is
        }
        
        // Update variables immediately
        changedVars[`sub_${subscription.id}`] = displayValue
        if (subscription.customVariableName) {
          changedVars[subscription.customVariableName] = displayValue
          this.customVariables.set(subscription.customVariableName, valueUpdate.value)
        }
      }
    }

    // Set changed variables
    if (Object.keys(changedVars).length > 0) {
      this.setVariableValues(changedVars)
    }

    // Update feedbacks when values change
    this.checkFeedbacks()
  }

  private updateVariableDefinitions(): void {
    const variableDefinitions = getVariableDefinitions()
    const activeCustomVariables = new Set<string>()
    
    // Add dynamic variables for each subscription
    this.subscriptions.forEach((sub) => {
      if (sub.customVariableName) {
        activeCustomVariables.add(sub.customVariableName)
        // Ensure variable definition exists if it's a custom one we're managing
        if (this.managedCustomVariables.has(sub.customVariableName)) {
          if (!variableDefinitions.some(v => v.variableId === sub.customVariableName)) {
            variableDefinitions.push({
              variableId: sub.customVariableName,
              name: `${sub.objectPath}.${sub.propertyPath}`,
            })
            this.log('info', `Added variable definition: ${sub.customVariableName}`)
          }
        } else {
          this.log('warn', `Custom variable ${sub.customVariableName} not in managedCustomVariables`)
        }
      }
      variableDefinitions.push({
        variableId: `sub_${sub.id}`,
        name: `Subscription ${sub.id}: ${sub.objectPath}.${sub.propertyPath}`,
      })
    })

    // Note: We don't clean up managedCustomVariables here because subscriptions
    // are confirmed asynchronously. Variables should only be removed when explicitly
    // unsubscribed via the unsubscribe action.
    
    this.log('info', `Setting ${variableDefinitions.length} variable definitions`)
    this.setVariableDefinitions(variableDefinitions)
  }

  /**
   * Rebuild the custom variables cache from current subscriptions
   */
  private updateCustomVariablesCache(): void {
      this.customVariables.clear()
      this.subscriptions.forEach(sub => {
          if (sub.customVariableName) {
              this.customVariables.set(sub.customVariableName, sub.value)
          }
      })
  }

  /**
   * Clean up pending subscriptions that have timed out
   */
  private cleanupPendingSubscriptions(): void {
    const now = Date.now()
    const timeout = this.config.pendingSubscriptionTimeout ?? 30000
    
    for (const [key, pending] of this.pendingSubscriptions.entries()) {
      if (now - pending.timestamp > timeout) {
        this.log('warn', `Pending subscription timed out: ${key}`)
        this.pendingSubscriptions.delete(key)
        
        // Clean up orphaned variable definition if it was created
        if (pending.variableName) {
            this.managedCustomVariables.delete(pending.variableName)
            this.updateVariableDefinitions()
        }
      }
    }
  }

  /**
   * Start periodic cleanup timer for pending subscriptions
   */
  private startPendingCleanupTimer(): void {
    if (this.pendingCleanupTimer) {
      clearTimeout(this.pendingCleanupTimer)
    }
    
    this.pendingCleanupTimer = setTimeout(() => {
      this.cleanupPendingSubscriptions()
      // Reschedule if still connected
      if (this.connectionReady) {
        this.startPendingCleanupTimer()
      }
    }, this.config.pendingSubscriptionTimeout ?? 30000)
  }
}

runEntrypoint(DisguiseInstance, upgradeScripts)

export type { DisguiseConfig }

