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
          feedbackId: 'subscribeToProperty',
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
          feedbackId: 'subscribeToProperty',
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
          feedbackId: 'subscribeToProperty',
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
          feedbackId: 'subscribeToProperty',
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
    
    ledScreenOffset: {
      type: 'button',
      category: 'Screen Monitoring',
      name: 'LED Screen Offset',
      style: {
        text: '`LED Offset\\nX: ${toFixed(jsonparse(parseVariables(\'$(liveupdate:ledscreen)\'))[\'x\'], 2)}\\nY: ${toFixed(jsonparse(parseVariables(\'$(liveupdate:ledscreen)\'))[\'y\'], 2)}\\nZ: ${toFixed(jsonparse(parseVariables(\'$(liveupdate:ledscreen)\'))[\'z\'], 2)}`',
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
          feedbackId: 'subscribeToProperty',
          options: {
            variableName: 'ledscreen',
            objectPath: 'ledscreen:myledscreen',
            propertyPath: 'object.offset',
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
