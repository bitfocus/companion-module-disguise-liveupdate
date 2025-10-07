# disguise LiveUpdate Module Help

This module provides integration with the disguise LiveUpdate API, allowing real-time monitoring and control of Designer properties via WebSocket.

## Configuration

### Connection Settings
- **Director IP Address**: The IP address of the Disguise Designer Director machine (default: 127.0.0.1)
- **Port**: The port number for the LiveUpdate API (default: 80)
- **Reconnect Interval**: Time in milliseconds to wait before attempting to reconnect after a connection failure (default: 5000ms)

## Actions

### Subscribe to Property
Subscribe to a LiveUpdate property to monitor its value in real-time.

**Parameters:**
- **Object Path**: Designer expression to find the object (e.g., `track:track_1`, `screen2:screen_1`)
- **Property Path**: Python expression to access the property (e.g., `object.description`, `object.lengthInBeats`)
- **Update Frequency (ms)**: Minimum time between updates in milliseconds (0 = as fast as possible)

**Examples:**
- Object: `track:track_1`, Property: `object.lengthInBeats` - Get track length
- Object: `screen2:screen_1`, Property: `object.description` - Get screen name
- Object: `subsystem:MonitoringManager.findLocalMonitor("fps")`, Property: `object.seriesAverage("Actual", 1)` - Get FPS

### Unsubscribe from Property
Unsubscribe from a LiveUpdate property using its subscription ID.

**Parameters:**
- **Subscription ID**: The ID returned when the subscription was created

### Set Property (String)
Set a string value for a subscribed property.

**Parameters:**
- **Subscription ID**: The ID of the subscription to update
- **Value**: The string value to set

### Set Property (Number)
Set a numeric value for a subscribed property.

**Parameters:**
- **Subscription ID**: The ID of the subscription to update
- **Value**: The numeric value to set

### Set Property (Boolean)
Set a boolean value for a subscribed property.

**Parameters:**
- **Subscription ID**: The ID of the subscription to update
- **Value**: True or False

### Set Property (JSON)
Set a complex JSON value for a subscribed property (e.g., for objects with multiple fields).

**Parameters:**
- **Subscription ID**: The ID of the subscription to update
- **JSON Value**: Valid JSON object or value (e.g., `{"x": 1.0, "y": 2.0, "z": 0.0}`)

## Feedbacks

### Connection OK
Highlights buttons when the module is connected to Disguise Designer.

### Subscription Value Equals
Check if a subscription value equals a specific value.

**Parameters:**
- **Subscription ID**: The ID of the subscription to monitor
- **Expected Value**: The value to compare against

### Subscription Value Greater Than
Check if a subscription numeric value is greater than a threshold.

**Parameters:**
- **Subscription ID**: The ID of the subscription to monitor
- **Threshold**: The numeric threshold value

### Subscription Value Less Than
Check if a subscription numeric value is less than a threshold.

**Parameters:**
- **Subscription ID**: The ID of the subscription to monitor
- **Threshold**: The numeric threshold value

### Subscription Value Boolean
Check if a subscription boolean value matches the expected value.

**Parameters:**
- **Subscription ID**: The ID of the subscription to monitor
- **Expected Value**: True or False

## Variables

### connection_status
Shows the current connection status to Disguise Designer (Connected/Disconnected).

### Dynamic Subscription Variables
When you subscribe to properties, dynamic variables are automatically created following the format `sub_<id>`, where `<id>` is the subscription ID.

**Example:** If subscription ID 123 is monitoring a track's length, you can use `$(disguise-designer:sub_123)` to display the current value.

## Common Use Cases

### Monitor Track Length
1. Create a "Subscribe to Property" action
2. Set Object Path: `track:track_1`
3. Set Property Path: `object.lengthInBeats`
4. Note the subscription ID from the logs
5. Use variable `$(disguise-designer:sub_<ID>)` to display the value

### Monitor FPS
1. Create a "Subscribe to Property" action
2. Set Object Path: `subsystem:MonitoringManager.findLocalMonitor("fps")`
3. Set Property Path: `object.seriesAverage("Actual", 1)`
4. Add a feedback to highlight when FPS drops below 30

### Monitor RenderStream Workload Status
1. Create a "Subscribe to Property" action
2. Set Object Path: `subsystem:RenderStreamSystem`
3. Set Property Path: `object.getWorkloadReceiveStatuses(<workload ID>)`
4. Use the returned value to monitor workload health

### Change Screen Offset
1. First subscribe to the screen offset property: Object: `screen2:screen_1`, Property: `object.offset`
2. Note the subscription ID
3. Use "Set Property (JSON)" action with subscription ID and value: `{"x": 4.0, "y": 3.0, "z": 0.0}`

## Notes

- **Subscription IDs**: When you subscribe to a property, Disguise Designer assigns a unique ID. Check the module logs to see subscription IDs.
- **Reference Counting**: If you subscribe to the same property multiple times, you'll get the same subscription ID. Each subscription must be matched with an unsubscription.
- **Performance**: Unsubscribe from properties that aren't actively needed (e.g., when buttons aren't visible) to conserve resources.
- **Partial Updates**: When setting object properties (like coordinates), you can set only specific fields and other fields will be preserved.

## API Documentation

For detailed information about the LiveUpdate API, visit:
https://developer.disguise.one/api/session/liveupdate/

## Support

For questions about Disguise Designer integration:
- integrations@disguise.one

For general Disguise support:
- support@disguise.one
- help.disguise.one