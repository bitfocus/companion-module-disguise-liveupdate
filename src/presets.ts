import { CompanionPresetDefinitions, combineRgb } from '@companion-module/base'
import type { DisguiseInstance } from './index'

export function getPresetDefinitions(
  _instance: DisguiseInstance,
): CompanionPresetDefinitions {
  return {
    trackLengthMonitor: {
      type: 'button',
      category: 'Track Monitoring',
      name: 'Track Length Monitor',
      style: {
        text: '`Track 1\\nLength\\n${secondsToTimestamp($(liveupdate:track_length))}`',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(100, 50, 200),
        textExpression: true,
      },
      steps: [
        {
          down: [],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'track_length',
            objectPath: 'track:track_1',
            propertyPath: 'object.lengthInBeats',
            updateFrequency: 0,
          },
        },
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
      name: 'Screen Name Monitor',
      style: {
        text: 'Surface 1\\n$(liveupdate:screen_name)',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(200, 100, 50),
      },
      steps: [
        {
          down: [],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'screen_name',
            objectPath: 'screen2:surface_1',
            propertyPath: 'object.mesh.description',
            updateFrequency: 0,
          },
        },
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
        text: '`FPS\\n${toFixed($(liveupdate:fps), 1)}`',
        size: '18',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 150, 0),
        textExpression: true,
      },
      steps: [
        {
          down: [],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'fps',
            objectPath: 'subsystem:MonitoringManager.findLocalMonitor("fps")',
            propertyPath: 'object.seriesAverage("Actual", 1)',
            updateFrequency: 1000,
          },
        },
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
    
    playheadMonitor: {
      type: 'button',
      category: 'Transport',
      name: 'Playhead Readout',
      style: {
        text: '`Playhead\\n${secondsToTimestamp($(liveupdate:playhead))}`',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(50, 100, 200),
        textExpression: true,
      },
      steps: [
        {
          down: [],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'playhead',
            objectPath: 'transportManager:default',
            propertyPath: 'object.player.tRender',
            updateFrequency: 100,
          },
        },
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
    
    screenOffsetMonitor: {
      type: 'button',
      category: 'Screen Control',
      name: 'Screen Offset Monitor',
      style: {
        text: '`Screen X\\n${toFixed($(liveupdate:screen_x), 1)}`',
        size: '14',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(50, 150, 200),
        textExpression: true,
      },
      steps: [
        {
          down: [],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'screen_x',
            objectPath: 'screen2:surface_1',
            propertyPath: 'object.offset.x',
            updateFrequency: 0,
          },
        },
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
    
    screenOffsetSetPlus: {
      type: 'button',
      category: 'Screen Control',
      name: 'Screen X +1',
      style: {
        text: 'X +1',
        size: '18',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(0, 100, 200),
      },
      steps: [
        {
          down: [
            {
              actionId: 'setToDisguiseNumber',
              options: {
                variableName: 'screen_x',
                value: '$(liveupdate:screen_x)+1',
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'screen_x',
            objectPath: 'screen2:surface_1',
            propertyPath: 'object.offset.x',
            updateFrequency: 0,
          },
        },
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
    
    screenOffsetSetMinus: {
      type: 'button',
      category: 'Screen Control',
      name: 'Screen X -1',
      style: {
        text: 'X -1',
        size: '18',
        color: combineRgb(255, 255, 255),
        bgcolor: combineRgb(200, 100, 0),
      },
      steps: [
        {
          down: [
            {
              actionId: 'setToDisguiseNumber',
              options: {
                variableName: 'screen_x',
                value: '$(liveupdate:screen_x)-1',
              },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [
        {
          feedbackId: 'liveUpdateVariable',
          options: {
            variableName: 'screen_x',
            objectPath: 'screen2:surface_1',
            propertyPath: 'object.offset.x',
            updateFrequency: 0,
          },
        },
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
