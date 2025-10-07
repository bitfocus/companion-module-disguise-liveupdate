import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'
import type { DisguiseInstance } from './index'

export function getPresetDefinitions(
  _instance: DisguiseInstance,
): CompanionPresetDefinitions {
  return {
    trackLengthMonitor: {
      type: 'button',
      category: 'Track Monitoring',
      name: 'Track Length Monitor (Example)',
      style: {
        text: '`Track 1\\nLength\\n${secondsToTimestamp($(disguise-liveupdate:track_length))}`',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(100, 50, 200),
        textExpression: true,
      },
      steps: [
        {
          down: [
            {
              actionId: 'subscribe',
              options: {
                objectPath: 'track:track_1',
                propertyPath: 'object.lengthInBeats',
                customVariableName: 'track_length',
                updateFrequency: 0,
                autoSubscribe: true,
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'connectionState',
          options: {},
          style: {
            bgcolor: combineRgb(0, 200, 0),
            color: combineRgb(0, 0, 0),
          },
        },
      ],
    },
    
    screenNameMonitor: {
      type: 'button',
      category: 'Screen Monitoring',
      name: 'Screen Name Monitor (Example)',
      style: {
        text: 'Surface 1\\n$(disguise-liveupdate:screen_name)',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(200, 100, 50),
      },
      steps: [
        {
          down: [
            {
              actionId: 'subscribe',
              options: {
                objectPath: 'screen2:surface_1',
                propertyPath: 'object.mesh.description',
                customVariableName: 'screen_name',
                updateFrequency: 0,
                autoSubscribe: true,
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'connectionState',
          options: {},
          style: {
            bgcolor: combineRgb(0, 200, 0),
            color: combineRgb(0, 0, 0),
          },
        },
      ],
    },
    
    fpsMonitor: {
      type: 'button',
      category: 'Performance Monitoring',
      name: 'FPS Monitor',
      style: {
        text: '`FPS\\n${toFixed($(disguise-liveupdate:fps), 1)}`',
        size: '18',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 150, 0),
        textExpression: true,
      },
      steps: [
        {
          down: [
            {
              actionId: 'subscribe',
              options: {
                objectPath: 'subsystem:MonitoringManager.findLocalMonitor("fps")',
                propertyPath: 'object.seriesAverage("Actual", 1)',
                customVariableName: 'fps',
                updateFrequency: 1000,
                autoSubscribe: true,
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'variableValueLessThan',
          options: {
            variableName: 'fps',
            threshold: '30',
          },
          style: {
            bgcolor: combineRgb(200, 0, 0),
            color: combineRgb(255, 255, 255),
          },
        },
        {
          feedbackId: 'variableValueLessThan',
          options: {
            variableName: 'fps',
            threshold: '60',
          },
          style: {
            bgcolor: combineRgb(200, 150, 0),
            color: combineRgb(0, 0, 0),
          },
        },
      ],
    },
    
    playheadMonitor: {
      type: 'button',
      category: 'Transport',
      name: 'Playhead Readout',
      style: {
        text: '`Playhead\\n${secondsToTimestamp($(disguise-liveupdate:playhead))}`',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(50, 100, 200),
        textExpression: true,
      },
      steps: [
        {
          down: [
            {
              actionId: 'subscribe',
              options: {
                objectPath: 'transportManager:default',
                propertyPath: 'object.player.tRender',
                customVariableName: 'playhead',
                updateFrequency: 100,
                autoSubscribe: true,
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'connectionState',
          options: {},
          style: {
            bgcolor: combineRgb(0, 200, 0),
            color: combineRgb(0, 0, 0),
          },
        },
      ],
    },
    
    ledScreenOffset: {
      type: 'button',
      category: 'Screen Monitoring',
      name: 'LED Screen Offset',
      style: {
        text: '`LED Offset\\nX: ${toFixed(jsonparse(parseVariables(\'$(disguise-liveupdate:ledscreen)\'))[\'x\'], 2)}\\nY: ${toFixed(jsonparse(parseVariables(\'$(disguise-liveupdate:ledscreen)\'))[\'y\'], 2)}\\nZ: ${toFixed(jsonparse(parseVariables(\'$(disguise-liveupdate:ledscreen)\'))[\'z\'], 2)}`',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(50, 150, 200),
        textExpression: true,
      },
      steps: [
        {
          down: [
            {
              actionId: 'subscribe',
              options: {
                objectPath: 'ledscreen:myledscreen',
                propertyPath: 'object.offset',
                customVariableName: 'ledscreen',
                updateFrequency: 0,
                autoSubscribe: true,
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'connectionState',
          options: {},
          style: {
            bgcolor: combineRgb(0, 200, 0),
            color: combineRgb(0, 0, 0),
          },
        },
      ],
    },
    
  }
}
