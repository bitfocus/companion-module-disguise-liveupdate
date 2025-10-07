# companion-module-disguise-designer

Bitfocus Companion module for disguise LiveUpdate API.

## Description

This module provides real-time integration with Disguise Designer through the WebSocket-based LiveUpdate API. It allows you to:

- Subscribe to properties in Designer and monitor their values in real-time
- Set property values remotely (strings, numbers, booleans, and complex JSON objects)
- Create feedbacks based on property values
- Use dynamic variables to display property values on buttons

## Supported Devices

- Disguise Designer (all versions with LiveUpdate API support)

## Configuration

- **Director IP Address**: The IP address of the Disguise Designer Director machine
- **Port**: The port number for the LiveUpdate API (default: 80)
- **Reconnect Interval**: Time to wait before reconnecting after connection loss

## Actions

- **Subscribe to Property**: Monitor a Designer property in real-time
- **Unsubscribe from Property**: Stop monitoring a property
- **Set Property (String/Number/Boolean/JSON)**: Change property values

## Feedbacks

- **Connection OK**: Indicates connection status
- **Subscription Value Equals**: Check if a value matches
- **Subscription Value Greater/Less Than**: Numeric comparisons
- **Subscription Value Boolean**: Boolean checks

## Variables

- `connection_status`: Current connection status
- `sub_<id>`: Dynamic variables for each subscription (where `<id>` is the subscription ID)

## Development

### Setup

```bash
npm install
npm run build
```

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run watch
```

## API Documentation

For detailed information about the Disguise Designer LiveUpdate API:
https://developer.disguise.one/api/session/liveupdate/

## License

MIT

## Support

For questions about Disguise Designer integration:
- integrations@disguise.one
- support@disguise.one
- help.disguise.one
