/**
 * Minimal LiveUpdate Director served over a real WebSocket (ws) for integration tests.
 *
 * Implements the documented protocol subset used by the module:
 * - { subscribe: { object, properties: [...], configuration?: { updateFrequencyMs } } }
 *   -> { subscriptions: [...] } followed by { valuesChanged: [...] } for known values,
 *      or { error: "Unable to subscribe to OBJECT / PROPERTY - reason" } for unknown objects
 * - { unsubscribe: { id } } / { unsubscribe: { ids: [...] } } -> { subscriptions: [...] }
 * - { set: [{ id, value }] } -> the new value is stored and echoed as valuesChanged
 * Subscriptions are reference counted per (object, property) like the real Director.
 */
import { WebSocketServer, WebSocket, RawData } from 'ws'
import { AddressInfo } from 'node:net'

export interface MockValue {
	value: unknown
}

function rawDataToString(data: RawData): string {
	if (Buffer.isBuffer(data)) return data.toString('utf8')
	if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
	return Buffer.from(data).toString('utf8')
}

export class MockDirector {
	private server: WebSocketServer | null = null
	private nextId = 1
	/** Known property values: key `${object}\n${property}` */
	values = new Map<string, unknown>()
	/** Properties that resolve but evaluate to an error value */
	errorValues = new Map<string, unknown>()
	subscriptions: { id: number; objectPath: string; propertyPath: string; ref: number }[] = []
	received: any[] = []
	sets: { id: number; value: unknown }[] = []
	port = 0
	clients = new Set<WebSocket>()

	setValue(objectPath: string, propertyPath: string, value: unknown): void {
		this.values.set(`${objectPath}\n${propertyPath}`, value)
	}

	setErrorValue(objectPath: string, propertyPath: string, value: unknown): void {
		this.errorValues.set(`${objectPath}\n${propertyPath}`, value)
	}

	async listen(): Promise<number> {
		this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
		await new Promise<void>((resolve) => this.server!.once('listening', () => resolve()))
		this.port = (this.server.address() as AddressInfo).port
		this.server.on('connection', (socket) => {
			this.clients.add(socket)
			socket.on('message', (data: RawData) => this.handle(socket, rawDataToString(data)))
			socket.on('close', () => {
				this.clients.delete(socket)
				// The Director drops the subscriptions of a closed client
				this.subscriptions = []
			})
		})
		return this.port
	}

	async close(): Promise<void> {
		for (const client of this.clients) client.terminate()
		await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
	}

	/** Push a new value for a known pair to every client */
	publish(objectPath: string, propertyPath: string, value: unknown): void {
		this.setValue(objectPath, propertyPath, value)
		const sub = this.subscriptions.find((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)
		if (!sub) return
		this.broadcast({ valuesChanged: [{ id: sub.id, value, changeTimestamp: 1, messageTimestamp: 2 }] })
	}

	private broadcast(message: unknown): void {
		const text = JSON.stringify(message)
		for (const client of this.clients) if (client.readyState === WebSocket.OPEN) client.send(text)
	}

	private subscriptionsMessage(): unknown {
		return {
			subscriptions: this.subscriptions.map((s) => ({
				id: s.id,
				objectPath: s.objectPath,
				propertyPath: s.propertyPath,
			})),
		}
	}

	private handle(socket: WebSocket, raw: string): void {
		let message: any
		try {
			message = JSON.parse(raw)
		} catch {
			socket.send(JSON.stringify({ error: 'invalid JSON' }))
			return
		}
		this.received.push(message)

		if (message.subscribe) {
			const objectPath = String(message.subscribe.object ?? '')
			const properties: string[] = Array.isArray(message.subscribe.properties) ? message.subscribe.properties : []
			if (!objectPath || properties.length === 0) {
				socket.send(JSON.stringify({ error: 'subscribe requires object and properties' }))
				return
			}
			for (const propertyPath of properties) {
				const key = `${objectPath}\n${propertyPath}`
				if (!this.values.has(key) && !this.errorValues.has(key)) {
					socket.send(
						JSON.stringify({ error: `Unable to subscribe to ${objectPath} / ${propertyPath} - object not found` }),
					)
					continue
				}
				let sub = this.subscriptions.find((s) => s.objectPath === objectPath && s.propertyPath === propertyPath)
				if (sub) sub.ref++
				else {
					sub = { id: this.nextId++, objectPath, propertyPath, ref: 1 }
					this.subscriptions.push(sub)
				}
				socket.send(JSON.stringify(this.subscriptionsMessage()))
				const value = this.errorValues.has(key) ? this.errorValues.get(key) : this.values.get(key)
				socket.send(JSON.stringify({ valuesChanged: [{ id: sub.id, value, changeTimestamp: 1, messageTimestamp: 2 }] }))
			}
			return
		}

		if (message.unsubscribe) {
			const ids: unknown[] = message.unsubscribe.ids ?? [message.unsubscribe.id]
			for (const id of ids) {
				if (typeof id !== 'number') {
					socket.send(JSON.stringify({ error: `unsubscribe id must be an integer: ${String(id)}` }))
					continue
				}
				const sub = this.subscriptions.find((s) => s.id === id)
				if (!sub) continue
				sub.ref--
				if (sub.ref <= 0) this.subscriptions = this.subscriptions.filter((s) => s !== sub)
			}
			socket.send(JSON.stringify(this.subscriptionsMessage()))
			return
		}

		if (message.set) {
			for (const item of message.set) {
				const sub = this.subscriptions.find((s) => s.id === item.id)
				if (!sub) {
					socket.send(JSON.stringify({ error: `set: unknown subscription id ${String(item.id)}` }))
					continue
				}
				this.sets.push({ id: item.id, value: item.value })
				const key = `${sub.objectPath}\n${sub.propertyPath}`
				const current = this.values.get(key)
				const next =
					current && typeof current === 'object' && item.value && typeof item.value === 'object'
						? { ...current, ...item.value }
						: item.value
				this.values.set(key, next)
				this.broadcast({ valuesChanged: [{ id: sub.id, value: next, changeTimestamp: 3, messageTimestamp: 4 }] })
			}
		}
	}
}
