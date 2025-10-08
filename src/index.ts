import {
  InstanceBase,
  InstanceStatus,
  Regex,
  runEntrypoint,
  CompanionActionContext,
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
  feedbackId: string // The feedback ID that created this subscription
  variableName: string // The module variable to update
  value?: any
  changeTimestamp?: number
  messageTimestamp?: number
  errorCount?: number // Track consecutive errors
}

/**
 * Disguise Designer module instance with LiveUpdate API support
 */
export class DisguiseInstance extends InstanceBase<DisguiseConfig> {
  public config!: DisguiseConfig
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | undefined
  private pendingCleanupTimer: NodeJS.Timeout | undefined
  private subscriptions: Map<number, LiveUpdateSubscription> = new Map()
  private feedbackIdToSubscriptionId: Map<string, number> = new Map() // Map feedback ID to subscription ID
  private pendingSubscriptions: Map<string, { feedbackId: string; variableName: string; timestamp: number }> = new Map()
  public feedbackOptionsCache: Map<string, { objectPath: string; propertyPath: string; variableName: string }> = new Map() // Track last known options
  private connectionReady = false
  private shouldReconnect = false

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
    this.feedbackIdToSubscriptionId.clear()
    this.pendingSubscriptions.clear()
    this.feedbackOptionsCache.clear()
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
   * Get the current value of a subscription by feedback ID
   */
  getSubscriptionValueByFeedbackId(feedbackId: string): any {
    const subId = this.feedbackIdToSubscriptionId.get(feedbackId)
    if (subId !== undefined) {
      return this.subscriptions.get(subId)?.value
    }
    return undefined
  }

  /**
   * Get a subscription by feedback ID
   */
  getSubscriptionByFeedbackId(feedbackId: string): LiveUpdateSubscription | undefined {
    const subId = this.feedbackIdToSubscriptionId.get(feedbackId)
    if (subId !== undefined) {
      return this.subscriptions.get(subId)
    }
    return undefined
  }

  /**
   * Check if feedback options have changed and update subscription if needed
   * Also ensures subscription is active (self-healing)
   */
  checkAndUpdateSubscription(
    feedbackId: string,
    variableName: string,
    objectPath: string,
    propertyPath: string,
    updateFrequency?: number
  ): void {
    const cached = this.feedbackOptionsCache.get(feedbackId)
    const existingSubscription = this.getSubscriptionByFeedbackId(feedbackId)
    
    // Check if we need to subscribe (first time or subscription was dropped)
    if (!cached) {
      // First evaluation - cache it and check if we need to subscribe
      this.feedbackOptionsCache.set(feedbackId, { variableName, objectPath, propertyPath })
      
      // If no active subscription and we're connected, subscribe
      if (!existingSubscription && this.isConnectionReady() && variableName && objectPath && propertyPath) {
        this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
      }
      return
    }
    
    // Check if options have changed
    const optionsChanged = 
      cached.variableName !== variableName ||
      cached.objectPath !== objectPath ||
      cached.propertyPath !== propertyPath
    
    if (optionsChanged) {
      this.log('info', `Feedback options changed: ${cached.objectPath}.${cached.propertyPath} → ${objectPath}.${propertyPath}`)
      
      // Update cache
      this.feedbackOptionsCache.set(feedbackId, { variableName, objectPath, propertyPath })
      
      // Unsubscribe old subscription if it exists
      this.unsubscribeFromVariable(feedbackId)
      
      // Subscribe with new options
      if (variableName && objectPath && propertyPath) {
        this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
      }
      return
    }
    
    // Self-healing: if subscription was dropped but options haven't changed, recreate it
    if (!existingSubscription && this.isConnectionReady() && variableName && objectPath && propertyPath) {
      this.log('info', `Subscription for feedback ${feedbackId} was dropped, recreating automatically`)
      this.subscribeToVariable(feedbackId, variableName, objectPath, propertyPath, updateFrequency)
    }
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
   * Subscribe to a LiveUpdate property and bind it to a module variable
   */
  subscribeToVariable(
    feedbackId: string,
    variableName: string,
    objectPath: string,
    propertyPath: string,
    updateFrequencyMs: number | undefined
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot subscribe - WebSocket not connected')
      return
    }

    const message: any = {
      subscribe: {
        object: objectPath,
        properties: [propertyPath],
      },
    }

    if (updateFrequencyMs !== undefined && updateFrequencyMs > 0) {
      message.subscribe.configuration = { updateFrequencyMs }
    }

    this.log('info', `Subscribing to ${objectPath}.${propertyPath} as variable '${variableName}'`)
    
    if (!this.send(message)) {
      return
    }
    
    // Store the subscription details for when we get the subscription ID back
    const key = `${objectPath}:${propertyPath}`
    this.pendingSubscriptions.set(key, { feedbackId, variableName, timestamp: Date.now() })
    
    // Set initial placeholder value and define the variable
    this.setVariableValues({ [variableName]: '...' })
  }

  /**
   * Unsubscribe from a LiveUpdate property by feedback ID
   */
  unsubscribeFromVariable(feedbackId: string): void {
    const subscriptionId = this.feedbackIdToSubscriptionId.get(feedbackId)
    
    // Clean up any pending subscriptions for this feedback
    for (const [key, pending] of this.pendingSubscriptions.entries()) {
      if (pending.feedbackId === feedbackId) {
        this.pendingSubscriptions.delete(key)
        // Cleaned up pending subscription
      }
    }
    
    if (subscriptionId === undefined) {
      return
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot unsubscribe - WebSocket not connected')
      // Still clean up local state even if not connected
      this.subscriptions.delete(subscriptionId)
      this.feedbackIdToSubscriptionId.delete(feedbackId)
      this.updateVariableDefinitions()
      return
    }

    const subscription = this.subscriptions.get(subscriptionId)
    
    const message = {
      unsubscribe: { id: subscriptionId },
    }

    this.log('info', `Unsubscribing from ${subscription?.objectPath}.${subscription?.propertyPath}`)
    
    this.send(message)
    
    // Clean up mappings
    this.subscriptions.delete(subscriptionId)
    this.feedbackIdToSubscriptionId.delete(feedbackId)
    
    // Update variable definitions after removing subscription
    this.updateVariableDefinitions()
  }

  /**
   * Set a LiveUpdate property value by subscription ID
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

  /**
   * Set a Disguise property value by object and property paths (one-time set, no subscription)
   */
  setPropertyByPath(objectPath: string, propertyPath: string, value: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot set property - WebSocket not connected')
      return
    }

    // First, check if we already have a subscription for this property
    let subscriptionId: number | undefined
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.objectPath === objectPath && sub.propertyPath === propertyPath) {
        subscriptionId = id
        break
      }
    }

    if (subscriptionId !== undefined) {
      // Use existing subscription to set the value
      this.setProperty(subscriptionId, value)
    } else {
      // No subscription exists - we need to subscribe, set, and unsubscribe
      // For now, just log a warning. In the future, we could implement temporary subscriptions.
      this.log('warn', `Cannot set ${objectPath}.${propertyPath} - no active subscription. Use "Read from Disguise" action first.`)
    }
  }

  private async applyConfig(config: DisguiseConfig): Promise<void> {
    this.config = config

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
        
        // Re-subscribe all existing feedbacks
        this.subscribeFeedbacks()
        
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
        this.feedbackIdToSubscriptionId.clear()
        this.feedbackOptionsCache.clear()
        this.setVariableValues({
          connection_status: 'Disconnected',
        })
        
        // Clear timers on disconnect
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
    this.feedbackIdToSubscriptionId.clear()
    this.pendingSubscriptions.clear()
    this.feedbackOptionsCache.clear()
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
        
        // Try to extract object/property paths from error message and clean up pending subscription
        // Error format: "Unable to subscribe to OBJECT / PROPERTY - ..."
        const match = message.error.match(/Unable to subscribe to (.+?) \/ (.+?) -/)
        if (match && match[1] && match[2]) {
          const objectPath = match[1].trim()
          const propertyPath = match[2].trim()
          const key = `${objectPath}:${propertyPath}`
          
          if (this.pendingSubscriptions.has(key)) {
            const pending = this.pendingSubscriptions.get(key)!
            this.log('warn', `Removing failed pending subscription for variable '${pending.variableName}'`)
            this.pendingSubscriptions.delete(key)
            
            // Set error message in the variable so user knows it failed
            this.setVariableValues({ [pending.variableName]: 'ERROR' })
          }
        }
        
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
    this.log('info', `Subscriptions updated: ${subscriptions.length} active`)
    
    // Update our subscription map
    const newSubscriptions = new Map<number, LiveUpdateSubscription>()
    const newFeedbackMap = new Map<string, number>()
    
    for (const sub of subscriptions) {
      const existing = this.subscriptions.get(sub.id)
      
      // Check if this matches any pending subscription
      const key = `${sub.objectPath}:${sub.propertyPath}`
      if (this.pendingSubscriptions.has(key)) {
        const pending = this.pendingSubscriptions.get(key)!
        
        newSubscriptions.set(sub.id, {
          id: sub.id,
          objectPath: sub.objectPath,
          propertyPath: sub.propertyPath,
          feedbackId: pending.feedbackId,
          variableName: pending.variableName,
          value: existing?.value,
          changeTimestamp: existing?.changeTimestamp,
          messageTimestamp: existing?.messageTimestamp,
        })
        
        newFeedbackMap.set(pending.feedbackId, sub.id)
        this.log('info', `Subscription ${sub.id}: ${sub.objectPath}.${sub.propertyPath} -> variable: ${pending.variableName}`)
        this.pendingSubscriptions.delete(key)
      } else if (existing) {
        // Preserve existing subscription
        newSubscriptions.set(sub.id, existing)
        newFeedbackMap.set(existing.feedbackId, sub.id)
      }
    }
    
    this.subscriptions = newSubscriptions
    this.feedbackIdToSubscriptionId = newFeedbackMap

    // Update feedbacks and variable definitions
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

        // Check if the value is an error object from Disguise
        if (valueUpdate.value && typeof valueUpdate.value === 'object' && valueUpdate.value.errorType) {
          const errorType = valueUpdate.value.errorType
          const errorMessage = valueUpdate.value.message || 'Unknown error'
          
          // Track consecutive errors
          subscription.errorCount = (subscription.errorCount || 0) + 1
          
          this.log('error', `Property path error for ${subscription.objectPath}.${subscription.propertyPath}: ${errorMessage} (error count: ${subscription.errorCount})`)
          
          // If we've hit 3 consecutive errors, unsubscribe and let user fix it
          if (subscription.errorCount >= 3) {
            this.log('warn', `Unsubscribing variable '${subscription.variableName}' after ${subscription.errorCount} consecutive errors`)
            this.log('warn', `Fix the property path in the feedback and use "Refresh Subscriptions" action to retry`)
            
            // Unsubscribe from Disguise
            const message = { unsubscribe: { id: subscription.id } }
            this.send(message)
            
            // Clean up local state
            this.subscriptions.delete(subscription.id)
            this.feedbackIdToSubscriptionId.delete(subscription.feedbackId)
            
            // Set error indicator in variable
            changedVars[subscription.variableName] = 'PATH_ERROR (unsubscribed)'
            
            // Update variable definitions
            this.updateVariableDefinitions()
          } else {
            this.log('warn', `Variable '${subscription.variableName}' has invalid property path`)
            changedVars[subscription.variableName] = 'PATH_ERROR'
          }
          
          continue
        }
        
        // Reset error count on successful value update
        subscription.errorCount = 0

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
        
        // Update the module variable
        changedVars[subscription.variableName] = displayValue
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
    
    // Add dynamic variables for each subscription
    this.subscriptions.forEach((sub) => {
      variableDefinitions.push({
        variableId: sub.variableName,
        name: `${sub.objectPath}.${sub.propertyPath}`,
      })
    })
    
    this.log('info', `Setting ${variableDefinitions.length} variable definitions`)
    this.setVariableDefinitions(variableDefinitions)
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
        this.updateVariableDefinitions()
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

