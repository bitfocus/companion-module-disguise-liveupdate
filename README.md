# companion-module-liveupdate

Bitfocus Companion module for Disguise LiveUpdate API.

## Description

This module provides real-time integration with Disguise Designer through the WebSocket-based LiveUpdate API. It allows you to:

- Monitor Designer properties in real-time using **feedbacks** that create dynamic variables
- Set property values remotely (strings, numbers, booleans, and complex JSON objects)
- Use Companion's expression system for visual feedback based on property values
- Automatically handle connection recovery and subscription healing

## Key Features

- **Feedback-Based Subscriptions**: Add "Subscribe to Disguise Property" feedbacks to buttons to create live-updating module variables
- **Self-Healing**: Automatic reconnection and subscription recovery after errors or connection loss
- **Auto-Update Detection**: Subscriptions automatically update when you change feedback options
- **Type-Safe Actions**: Separate actions for String, Number, Boolean, and JSON property types
- **No Manual Management**: No subscription IDs or manual refresh needed - everything happens automatically

## Supported Devices

- Disguise Designer (all versions with LiveUpdate API support)

## Configuration

- **Director IP Address**: The IP address of the Disguise Designer Director machine (default: 127.0.0.1)
- **Port**: The port number for the LiveUpdate API (default: 80)
- **Reconnect Interval**: Time to wait before reconnecting after connection loss (default: 5000ms)
- **Pending Subscription Timeout**: Maximum time to wait for subscription confirmation (default: 30000ms)

## Quick Start

### 1. Monitor a Property

1. Add **"Subscribe to Disguise Property"** feedback to a button
2. Configure:
   - Variable Name: `fps`
   - Object Path: `subsystem:MonitoringManager.findLocalMonitor("fps")`
   - Property Path: `object.seriesAverage("Actual", 1)`
3. Use `$(liveupdate:fps)` anywhere in Companion

### 2. Set a Property

1. Add **"Set to Disguise (Number)"** action to a button
2. Configure:
   - Value: `10.5`
   - Object Path: `screen2:surface_1`
   - Property Path: `object.offset.x`

## Feedbacks

### Subscribe to Disguise Property
Subscribes to a Designer property and creates a module variable that updates in real-time.

**Options:**
- Variable Name
- Object Path (Designer expression)
- Property Path (Python expression)
- Update Frequency (ms)

### Connection OK
Visual indicator showing connection status to Disguise Designer.

## Actions

### Set to Disguise (String)
Set text properties (e.g., `object.description`)

### Set to Disguise (Number)
Set numeric properties (e.g., `object.offset.x`)

### Set to Disguise (Boolean)
Set boolean properties (e.g., `object.enabled`)

### Set to Disguise (JSON)
Set complex properties (e.g., `object.offset` as `{"x": 1, "y": 2, "z": 0}`)

## Variables

### connection_status
Current connection status (`Connected` / `Disconnected`)

### Dynamic Module Variables
Variables are automatically created for each active subscription using the variable name you specify in the feedback.

**Example:** Variable name `fps` creates `$(liveupdate:fps)`

## Use With Expressions

Companion's expression variables work with module variables for powerful visual feedback:

```javascript
// Button background based on FPS
$(liveupdate:fps) < 30 ? rgb(200,0,0) : rgb(0,150,0)

// Formatted text
FPS: ${toFixed($(liveupdate:fps), 1)}

// Timecode display
${secondsToTimestamp($(liveupdate:playhead))}
```

## Development

### Setup
```bash
npm install
```

### Building
```bash
npm run build
```

### Development Mode
```bash
npm run watch
```

### Linting
```bash
npm run lint
```

## Architecture

This module uses Companion's feedback lifecycle to manage LiveUpdate subscriptions:
- **subscribe**: Creates LiveUpdate subscription when feedback is added
- **unsubscribe**: Removes subscription when feedback is removed
- **callback**: Monitors for option changes and handles self-healing

Module variables are dynamically created and updated as subscriptions receive data from Disguise.

## API Documentation

For detailed information about the Disguise Designer LiveUpdate API:
- [LiveUpdate API Documentation](https://developer.disguise.one/api/session/liveupdate/)
- [Designer Scripting Reference](https://developer.disguise.one/scripting/)

## License

MIT

## Support

For questions about Disguise Designer integration:
- integrations@disguise.one

For general Disguise support:
- support@disguise.one
- help.disguise.one
