# disguise: LiveUpdate

Monitor and control disguise Designer through its WebSocket **LiveUpdate API**: subscribe to any
property of the show (frame rate, transport state, track and layer data, screen geometry,
RenderStream health, failover state) as a live Companion variable, and write properties back.

**What LiveUpdate is not:** it does not issue transport commands. Play, stop, cue, section
navigation and fades stay with [companion-module-disguise-osc](https://github.com/bitfocus/companion-module-disguise-osc)
or the Designer REST Transport API. This module gives you the state readouts and the property knobs
around those commands; the two modules are meant to sit on the same page (see *Using with the OSC
module* below).

Object paths are verified against the Designer r34 LiveUpdate documentation and Python API stubs
(d3.pyi r34.0). On 2026-09-04 the catalog was checked read-only against a Designer r34.0.3 Director:
280 of the 310 default presets returned a live value (103 of them started as experimental rows and were
promoted after the run); the 25 presets that stay experimental need something the test project did
not have (an Expression Variables device, a DMX screen, a timecode source, a stage venue, a Text
layer, a running RenderStream instance). Every row carries its live result in
`docs/PRESET_CATALOG.md` (column *live*).

The write side was exercised on the same Director on 2026-09-04: 22 properties (layer enable, start,
length, brightness / pos.x / pos.y / scale.x key 0, constant brightness, track TC adjust, master
brightness, volume and engaged, surface offset / rotation / fade / hold / render layer, projector
fade and hold, and the same surface addressed by UID) were read, changed, confirmed, written back and
re-read; all of them came back to their original value. The module's own actions (Set Number with an
expression, Toggle Boolean, Set JSON with a partial object) were driven the same way. Expression
Variables writes are still untested: the test project has no Expression Variables device.
Note that the Director stores these values as 32-bit floats, so a written 0.9 reads back as
0.899999976; the presets display the rounded value.

Requires Companion 4.1 or newer.

## Configuration

### Connection settings

- **Director IP Address**: the Designer Director machine (default: 127.0.0.1)
- **Port**: HTTP/WebSocket port of the Director (default: 80)
- **Reconnect Interval (ms)**: wait before reconnecting after a connection loss (default: 5000)
- **Pending Subscription Timeout (ms)**: how long a subscribe request may stay unanswered (default: 30000)

### Preset settings

- **Show experimental presets**: adds the `99 Experimental` category (read-only presets whose object
  path is not documented for LiveUpdate, see *Experimental presets*). Off by default.
- **Monitoring / Playhead / State / Static interval (ms)**: the update intervals written into the
  presets when you place them (defaults 1000 / 250 / 500 / 5000). A placed button keeps its own
  value and can be edited per feedback; editing it re-subscribes. Buttons that share one property
  share one subscription, so the interval of the first placed button applies to all of them. `0`
  means "every frame" and is not recommended for monitors.

### Selections

The presets do not contain fixed object names. They address the show through **selection
variables** such as `$(liveupdate:selTrack)` inside their object paths, for example
`track:"$(liveupdate:selTrack)"`. Fill the selections in here once, or change them live with the
*Set selection* action; every preset built on a selection re-subscribes to the new object
automatically.

| Selection | Variable | What to enter |
|---|---|---|
| Track | `selTrack` | track name as shown in Designer, e.g. `Track 1` |
| Layer | `selLayer` | layer name inside the selected track, e.g. `Video 1` |
| Layer index | `selLayerIndex` | 0-based leaf-layer index (index-based probes only) |
| Section index | `selSection` | 0-based section index |
| Beat | `selBeat` | a track beat, e.g. `32` |
| Surface (screen2) | `selScreen` | surface name, e.g. `Surface 1` |
| Projector | `selProjector` | projector name |
| Display UID | `selScreenUid` | UID of any display, hex with `0x` (right-click the editor title bar > Copy UID) |
| Machine | `selMachine` | Machine resource name as listed in d3Net Manager |
| Remote host | `selHost` | hostname of the remote machine **without** `:d3` (the presets append it) |
| RenderStream workload id | `selWorkload` | integer id (REST `GET /api/session/renderstream/layerstatus` or the Cluster Workload widget > Copy UID) |
| RenderStream instance index | `selInstance` | 0-based |
| Expression Variables device UID | `selEvUid` | hex with `0x` |
| Expression variable index | `selEvIndex` | 0-based row inside the device |

Experimental presets use five more selections (`selTransport`, `selDmxScreen`, `selEvDevice`,
`selEvName`, `selEvLayer`); they only appear in the
settings when experimental presets are enabled.

Names are used verbatim (case-sensitive) inside quotes and must not contain quotes, backslashes or
line breaks; hostnames allow letters, digits, `.`, `_` and `-`; indices are plain decimal integers
(no leading zero); UIDs and workload ids are decimal or `0x` hex integers. Invalid values are
rejected with a log message. While a selection is empty the presets that depend on it show `$NA`
and do not subscribe. The variable names `sel...` and `connection_status` are reserved for the
module and cannot be used as LiveUpdate Variable names.

## Quick start

1. Enter the Director IP and save. The *Connection status* preset (category `01 Connection`) turns green.
2. Fill in the selections you need (for a first test `selTrack` is enough).
3. Open the preset browser and drag presets from `02 Monitoring Local` (FPS, GPU, CPU) and
   `04 Transport State` (playhead, play mode, master brightness). They start updating immediately.
4. Every readout is also a variable, e.g. `$(liveupdate:fps)`, usable in any button text, trigger or
   expression.

## How it works

The module subscribes to a Designer property with a **LiveUpdate Variable** feedback. Each feedback
names a variable (`fps`), an *object path* (a Designer expression that finds the object) and a
*property path* (a Python expression evaluated on that object). The value arrives as
`$(liveupdate:<variable>)`.

- Feedbacks with the same object and property paths share one subscription on the Director. The
  presets use one fixed variable name per property for that reason; keep the name when you copy a
  preset, and only rename it when you point the copy at a different object.
- Objects and arrays arrive as JSON text; use `jsonparse(...)` in an expression to read a field.
  Designer resources arrive as `{"uid": ..., "path": ..., "type": ...}`.
- Property paths run as Python 2.7 expressions on the Director; method calls, list and dictionary
  comprehensions are allowed. Never call a method that changes state inside a property path.
- "Set to Disguise" actions write to the subscription created by the feedback with the same variable
  name, so a control button always carries that feedback as well. Writes are undoable in Designer
  and are saved with the project.

## Presets

Categories are numbered because Companion sorts them alphabetically. Each category starts with a
*Setup* text preset that lists the selections it needs. Readouts use a dark style; write buttons are
amber, enable/on buttons green and disable/hold/off buttons red. Presets marked with a state colour
carry a *LiveUpdate Compare* feedback (for example FPS turns red below 50, "taken over" turns red).

### Experimental presets

Designer's Python API exposes far more than the LiveUpdate documentation shows. Presets whose object
path is only inferred from the API stub (for example `expressionvariablesdevice:"..."`,
`ledscreen:"..."`, `subsystem:D3NetManagerSystem`) are shipped read-only in `99 Experimental`, named
`[EXP] ...`, and only when *Show experimental presets* is enabled. They may show `ERROR` or
`PATH_ERROR`; that is not a module bug. Presets that prove to work on a Director are promoted to
their home category in a later release without changing their ids or variable names.

### Preset list

<!-- PRESETS:START -->

_310 presets ship by default; 25 experimental presets appear when "Show experimental presets" is enabled. Object paths use the selection variables described above._

### 01 Connection

> LiveUpdate can READ and SET Designer properties; it cannot issue transport commands (play, stop, cue, section navigation). Pair this module with companion-module-disguise-osc or the REST Transport API for commands. Presets address show objects through the module's own selection variables ($(liveupdate:selTrack), $(liveupdate:selScreen),...). Set them once in the connection settings (section "Selections") or from a button with the "Set selection" action; every preset that uses a selection re-subscribes automatically when it changes. Normal-tier selections: selBeat = a track beat as a number, e.g. 32; selEvIndex = 0-based row index of the variable inside the device (unquoted integer); selEvUid = UID of the Expression Variables device, hex with 0x prefix; selHost = hostname of the remote machine WITHOUT the:d3 suffix (the presets append it); selInstance = 0-based RenderStream instance index (unquoted integer); selLayer = layer name inside the selected track (selTrack), e.g. Video 1; selLayerIndex = 0-based position in the track layer list (unquoted integer) for the "(by index)" presets; selLedScreen = LED screen name; selMachine = Machine resource name exactly as listed in d3Net Manager (the same string is used for remote node lookups and RenderStream machine names; confirm on your Director); selProjector = projector name; selRsLayer = 0-based index among the track's RenderStream leaf layers; selScreen = Surface (screen2) name; selScreenUid = UID of any display, hex with 0x prefix (right-click the editor title bar > Copy UID); selSection = 0-based section index (unquoted integer); selStageUid = Stage UID, hex with 0x prefix; selTrack = track name as shown in Designer, e.g. Track 1 (quoted by the paths); selWorkload = RenderStream workload id as unquoted decimal digits (the RS Layer Workload ID preset shows it as text; also Cluster Workload widget > Copy UID or REST GET /api/session/renderstream/layerstatus). Experimental presets (category 99, names prefixed [EXP]) are hidden until the connection setting "Show experimental presets" is on; they use: selDmxScreen = DMX screen name; selEvDevice = Expression Variables device name (file name part of objects/ExpressionVariablesDevice/<name>.apx); selEvLayer = Expression Variables layer name (module: prefix); selEvName = expression variable name, case-sensitive; selTransport = transport manager name other than default. Update intervals are prefilled from the connection settings (Monitoring / Playhead / State / Static) and can be edited per button.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Session name | Name of the d3Net session the connected machine is in - confirms Companion is on the right session. | `subsystem:SessionSystem` | `object.sessionName` | `sessionName` | readout |
| Project name | Name of the open project (D3State.projectName via the global state) - confirms the right show file is loaded. | `subsystem:MonitoringManager` | `state.projectName` | `projectName` | readout |
| Designer version | Designer version string of the machine evaluating the expression (ReleaseVersion static method). | `subsystem:MonitoringManager` | `ReleaseVersion.versionString()` | `designerVersion` | readout |
| Designer version name | Alternative version format (ReleaseVersion.versionName()); keep whichever of the two rows reads best. | `subsystem:MonitoringManager` | `ReleaseVersion.versionName()` | `designerVersionName` | readout |
| Licence days left | Days left on the Designer licence of the connected machine; red when under two weeks. | `subsystem:MonitoringManager` | `state.getDaysLeftDesigner()` | `licenceDaysLeft` | readout |
| In show flag | D3State.isInShow - name suggests 'show mode engaged'; semantics undocumented, verify on the rig before relying on it. | `subsystem:MonitoringManager` | `state.isInShow` | `isInShow` | readout |
| Connection status | Single connection indicator for every page: green while the LiveUpdate WebSocket is open, FireBrick while disconnected, with the module's… |  |  | `connection_status` | readout |

### 02 Monitoring Local

> Local monitors need no selection: every preset subscribes to subsystem:MonitoringManager.findLocalMonitor(...) on the Director Companion is connected to.  Shown: FPS (latest, 10-sample and 60-sample average), GPU profiler frame time (Total, Compositor, GUI, Render Everything, DMX, Video Upload, Capture Upload) in ms, CPU Total (unit stated as ms by the help site; live on r34.0.3 the graph reports yUnits = "Units", so treat the number as relative), GPU memory (MB), Designer process memory (MB) and the "Machine" health monitor percentages (CPU/GPU time, CPU/GPU memory, Disk; source: disguise's official Grafana dashboard; values confirmed live on r34.0.3 in the 0-100 range).  Also included after the r34.0.3 live run: Disk read/write MB/s (the developer guide calls Disk over LiveUpdate work in progress, but the values arrive), monitor and series name discovery, GPU thresholds, FPS min/max and graph categories.  Update rate: monitoring class (default 1000 ms). Never set 0: monitors push every frame. Colour rules assume a 60 Hz project: red when FPS falls 10 below (latest) or 5 below (averages), GPU Total >= 17 ms, Machine % >= 80.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| FPS (latest) | Local frame rate, latest sample - the number in Designer's FPS bug; the primary health readout. | `subsystem:MonitoringManager.findLocalMonitor("fps")` | `object.seriesAverage("Actual", 1)` | `fps` | readout |
| FPS (10-sample avg) | FPS smoothed over 10 samples - the rolling average the guide recommends for alert colouring so content loads do not trip false positives. | `subsystem:MonitoringManager.findLocalMonitor("fps")` | `object.seriesAverage("Actual", 10)` | `fpsAvg10` | readout |
| FPS (60-sample avg) | FPS averaged over 60 samples (about one second at 60 fps) - the 'Average FPS' series of disguise's official Grafana dashboard. | `subsystem:MonitoringManager.findLocalMonitor("fps")` | `object.seriesAverage("Actual", 60)` | `fpsAvg60` | readout |
| GPU frame time (Total) | GPU profiler total frame time in ms; above the frame budget the server drops frames. | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("Total", 1)` | `gpuTotalMs` | readout |
| GPU Compositor (ms) | GPU time spent compositing all track elements - diagnostic sub-series of the GPU profiler. | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("Compositor", 1)` | `gpuCompositorMs` | readout |
| GPU GUI (ms) | GPU time spent rendering the Designer GUI - diagnostic sub-series. | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("GUI", 1)` | `gpuGuiMs` | readout |
| GPU Render Everything (ms) | Compositor + GUI render time - diagnostic sub-series. | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("Render Everything", 1)` | `gpuRenderEverythingMs` | readout |
| GPU DMX (ms) | Time spent downloading DMX each frame - diagnostic sub-series. | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("DMX", 1)` | `gpuDmxMs` | readout |
| GPU Video Upload (ms) | Video frame upload stage time - diagnostic sub-series (help page calls the upload stage 'Deliver Frames'). | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("Video Upload", 1)` | `gpuVideoUploadMs` | readout |
| GPU Capture Upload (ms) | Live capture upload stage time - diagnostic sub-series. | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `object.seriesAverage("Capture Upload", 1)` | `gpuCaptureUploadMs` | readout |
| CPU frame time (Total) | CPU graph 'Total' - working time + present-wait time per frame (help site: milliseconds); high working time with low present time means… | `subsystem:MonitoringManager.findLocalMonitor("CPU")` | `object.seriesAverage("Total", 1)` | `cpuTotalMs` | readout |
| GPU memory (MB) | GPU memory in use; a constantly rising value indicates a leak, otherwise it rises as textures upload and falls as they are evicted. | `subsystem:MonitoringManager.findLocalMonitor("GPUMemory")` | `object.seriesAverage("Usage(MB)", 1)` | `gpuMemMb` | readout |
| Process memory (MB) | Designer process memory (CPU RAM) in MB - leak watch for long-running shows. | `subsystem:MonitoringManager.findLocalMonitor("ProcessMemory")` | `object.seriesAverage("Usage (MB)", 1)` | `processMemMb` | readout |
| Machine CPU time % | Normalised CPU-time percentage from the aggregate 'Machine' health monitor - compact health-page value. | `subsystem:MonitoringManager.findLocalMonitor("Machine")` | `object.seriesAverage("CPU Time", 1)` | `machineCpuPct` | readout |
| Machine GPU time % | Normalised GPU-time percentage from the 'Machine' health monitor. | `subsystem:MonitoringManager.findLocalMonitor("Machine")` | `object.seriesAverage("GPU Time", 1)` | `machineGpuPct` | readout |
| Machine CPU memory % | System RAM usage percentage from the 'Machine' health monitor. | `subsystem:MonitoringManager.findLocalMonitor("Machine")` | `object.seriesAverage("CPU Memory", 1)` | `machineCpuMemPct` | readout |
| Machine GPU memory % | GPU memory usage percentage from the 'Machine' health monitor (percent counterpart of the MB readout). | `subsystem:MonitoringManager.findLocalMonitor("Machine")` | `object.seriesAverage("GPU Memory", 1)` | `machineGpuMemPct` | readout |
| Machine disk % | Disk utilisation percentage from the 'Machine' health monitor. | `subsystem:MonitoringManager.findLocalMonitor("Machine")` | `object.seriesAverage("Disk", 1)` | `machineDiskPct` | readout |
| Disk read (MB/s) | Disk read throughput in MB/s - shows content-load plateaus and starved playback. | `subsystem:MonitoringManager.findLocalMonitor("Disk")` | `object.seriesAverage("Read (MB/s)", 1)` | `diskReadMbs` | readout |
| Disk write (MB/s) | Disk write throughput in MB/s (recording / caching activity). | `subsystem:MonitoringManager.findLocalMonitor("Disk")` | `object.seriesAverage("Write (MB/s)", 1)` | `diskWriteMbs` | readout |
| Local monitor names (discovery) | Runtime list of every local monitor name on this build - the authoritative way to learn the strings findLocalMonitor accepts (Output… | `subsystem:MonitoringManager` | `[m.name for m in object.localMonitors().all()]` | `localMonitorNames` | readout |
| CPU series titles (discovery) | Exact series titles of the CPU monitor - resolves the UI-label-vs-API-title ambiguity (e.g. whether 'Working Time (ms)' exists) before more… | `subsystem:MonitoringManager.findLocalMonitor("CPU")` | `[s.name for s in object.graphDescriptor(False).dataSeries]` | `cpuSeriesNames` | readout |
| CPU graph Y units | Y-axis unit label of the CPU monitor - directly answers the open 'ms vs percent' question for monl_cpu_total. | `subsystem:MonitoringManager.findLocalMonitor("CPU")` | `object.graphDescriptor(False).yUnits` | `cpuUnits` | readout |
| GPU memory graph Y units | Y-axis unit label of the GPU memory monitor (candidate-exact form of the units expression; expected 'MB'). | `subsystem:MonitoringManager.findLocalMonitor("GPUMemory")` | `object.graphDescriptor(False).yUnits` | `gpuMemUnits` | readout |
| GPU profiler thresholds | Designer's own dotted threshold lines on the GPU profiler (50/60 fps frame budgets) as label/value pairs - lets a future colour rule use… | `subsystem:MonitoringManager.findLocalMonitor("GPUProfiler")` | `[{"label": t.label, "value": t.value} for t in object.graphDescriptor(False).thresholds]` | `gpuThresholds` | readout |
| FPS min/max in buffer | Worst and best FPS over the whole FIFO buffer plus the latest sample - 'worst fps in the last N frames', which seriesAverage cannot give. | `subsystem:MonitoringManager.findLocalMonitor("fps")` | `{s.name: {"latest": s.samples()[-1], "min": min(s.samples()), "max": max(s.samples())} for s in object.graphDescriptor(False).dataSeries if s.samples()}` | `fpsMinMax` | readout |
| Graph categories (discovery) | Static list of Monitoring Manager graph category names - also a probe for whether bare d3 type names resolve inside a LiveUpdate property… | `subsystem:MonitoringManager` | `MetricGraphCategories.categories()` | `graphCategories` | readout |

### 03 Monitoring Remote

> Set the selection selHost to the hostname of the remote Designer machine WITHOUT the ":d3" suffix (the presets append it, e.g. selHost = ACTOR01 -> "ACTOR01:d3"). Hostname case sensitivity is undocumented: copy it exactly as shown in d3Net / the "Remote nodes list" preset.  Shown: remote FPS (latest and 10-sample average), whether that remote fps graph has expired (stopped receiving data) and the list of remote nodes the MonitoringManager knows (discovery aid for selHost).  Also included after the live run: remote Machine CPU/GPU time, GPU/CPU totals, GPU memory and the per-node monitor name list.  Open points: only "fps" is documented as a remote monitor name; whether the Director must first mark the remote graph in use (MonitoringManager.useMonitorByName) is untested. A wrong selHost produces a LiveUpdate error; the module backs off before retrying.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Remote FPS (latest) | Frame rate of another machine in the session, addressed by hostname via $(liveupdate:selHost). | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "fps")` | `object.seriesAverage("Actual", 1)` | `remoteFps` | readout |
| Remote FPS (10-sample avg) | Smoothed remote FPS for alert colouring on a multi-machine page (guide recommends the 10-sample average for alerting). | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "fps")` | `object.seriesAverage("Actual", 10)` | `remoteFpsAvg10` | readout |
| Remote FPS monitor expired | Liveness flag: true when the remote fps graph has stopped receiving data (node offline or not publishing) - cheaper and clearer than… | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "fps")` | `object.expired` | `remoteFpsExpired` | readout |
| Remote nodes list | Names of the remote nodes known to the MonitoringManager - the discovery aid for filling in selHost. | `subsystem:MonitoringManager` | `object.remoteNodes()` | `remoteNodes` | readout |
| Remote node monitor names | Monitor names published by the node in selHost - discovery for the monitorName argument of findRemoteMonitor before promoting any non-fps… | `subsystem:MonitoringManager` | `[m.name for m in object.remoteMetricMonitorsForNode("$(liveupdate:selHost):d3").all()]` | `remoteMonitorNames` | readout |
| Remote Machine CPU time % | CPU-time percentage of the remote machine in selHost from its 'Machine' monitor (candidate-exact example of the remote-any pattern). | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "Machine")` | `object.seriesAverage("CPU Time", 1)` | `remoteMachineCpuPct` | readout |
| Remote Machine GPU time % | GPU-time percentage of the remote machine in selHost. | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "Machine")` | `object.seriesAverage("GPU Time", 1)` | `remoteMachineGpuPct` | readout |
| Remote GPU frame time (Total) | GPU profiler total frame time (ms) of the remote machine in selHost. | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "GPUProfiler")` | `object.seriesAverage("Total", 1)` | `remoteGpuTotalMs` | readout |
| Remote CPU frame time (Total) | CPU 'Total' of the remote machine in selHost (unit open, see monl_cpu_total). | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "CPU")` | `object.seriesAverage("Total", 1)` | `remoteCpuTotalMs` | readout |
| Remote GPU memory (MB) | GPU memory in use on the remote machine in selHost. | `subsystem:MonitoringManager.findRemoteMonitor("$(liveupdate:selHost):d3", "GPUMemory")` | `object.seriesAverage("Usage(MB)", 1)` | `remoteGpuMemMb` | readout |

### 04 Transport State

> Object path for every preset in this category: transportManager:default (Designer's default transport manager; no selection needed). Readouts: playhead in beats (equals seconds at 60 bpm), play mode as string and as state enum, playing / stopped / holding flags, play-to-end and loop-section modes, track loaded, playback speed, current track name and length, section count, timecode chase and source status strings, incoming timecode and pre-roll countdown. Controls: master brightness and volume (readout, +/-5 % nudges with rotary support, FULL / ZERO / MUTE), ENGAGE / DISENGAGE and a one-button Engaged toggle (Toggle Disguise Boolean action). Values with state colours use the LiveUpdate Compare feedback. Transport commands (play, stop, cue, section navigation) are not available over LiveUpdate: pair this module with companion-module-disguise-osc or the REST Transport API.  Also included after the live run: track position and timecode position strings, free-running flag, BPM at playhead, section index, current / next section names, section elapsed and remaining (beats), set-list track names, active layer count and the GUI playhead. Still experimental (99): the timecode source name and the playhead of a named transport (the test project has one transport and no timecode source).

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Playhead (beats) | Live playhead position of the default transport's TrackPlayer, in track beats (equals seconds at the default 60 bpm). The canonical… | `transportManager:default` | `object.player.tRender` | `playheadBeats` | readout |
| Play mode (string) | Current LIVE play state of the playhead as Designer's display string (Play / PlaySection / LoopSection / Stop / HoldSection / HoldEnd).… | `transportManager:default` | `object.player.playMode.__str__()` | `playMode` | readout |
| Play mode (state enum) | Current LIVE play state as an integer enum - the best field for boolean colour feedbacks (0 Play, 1 PlaySection, 2 LoopSection, 3 Stop, 4… | `transportManager:default` | `object.player.playMode.state` | `playModeState` | readout |
| Playing | True while the playhead is running - the simplest 'is the show running' light. | `transportManager:default` | `object.player.playing` | `isPlaying` | readout |
| Stopped | True while the transport is stopped. | `transportManager:default` | `object.player.stopped` | `isStopped` | readout |
| Holding | True while holding at the end of a section (play-to-end-of-section reached its cue; Designer's 'holding state'). | `transportManager:default` | `object.player.holding` | `isHolding` | readout |
| Play-to-end mode | True when the player is in play-to-end-of-section mode. | `transportManager:default` | `object.player.sectionPlayMode` | `sectionPlayMode` | readout |
| Loop section mode | True when the player is looping the current section. | `transportManager:default` | `object.player.loopSectionMode` | `loopSectionMode` | readout |
| Track loaded | True when a track is loaded in the player; guard lamp - every object.track.* row fails while this is false. | `transportManager:default` | `object.player.hasTrack` | `hasTrack` | readout |
| Playback speed | Playback speed ratio of the track player (1 = normal). | `transportManager:default` | `object.player.speed` | `speed` | readout |
| Master brightness | Master brightness / opacity of the transport manager (0..1). Mirrors the OSC module's brightness variable. | `transportManager:default` | `object.brightness` | `brightness` | readout |
| Brightness +5% | Nudge master brightness up by 0.05 (press or rotate right). | `transportManager:default` | `object.brightness` | `brightness` | nudge (Set to Disguise Number) |
| Brightness -5% | Nudge master brightness down by 0.05 (press or rotate left). | `transportManager:default` | `object.brightness` | `brightness` | nudge (Set to Disguise Number) |
| Brightness FULL | Set master brightness to 1.0. | `transportManager:default` | `object.brightness` | `brightness` | set value |
| Brightness ZERO | Set master brightness to 0.0 (video blackout). | `transportManager:default` | `object.brightness` | `brightness` | set value |
| Master volume | Master audio volume of the transport manager (0..1). Mirrors the OSC module's volume variable. | `transportManager:default` | `object.volume` | `volume` | readout |
| Volume +5% | Nudge master volume up by 0.05 (press or rotate right). | `transportManager:default` | `object.volume` | `volume` | nudge (Set to Disguise Number) |
| Volume -5% | Nudge master volume down by 0.05 (press or rotate left). | `transportManager:default` | `object.volume` | `volume` | nudge (Set to Disguise Number) |
| Volume FULL | Set master volume to 1.0. | `transportManager:default` | `object.volume` | `volume` | set value |
| Volume MUTE | Set master volume to 0.0. | `transportManager:default` | `object.volume` | `volume` | set value |
| Engaged state | Whether the transport manager honours external (remote) transport control; when disengaged all external control signals are ignored. | `transportManager:default` | `object.engaged` | `engaged` | readout |
| ENGAGE transport | Set engaged = true (honour external transport control). | `transportManager:default` | `object.engaged` | `engaged` | set on/off |
| DISENGAGE transport | Set engaged = false (ignore external transport control). | `transportManager:default` | `object.engaged` | `engaged` | set on/off |
| Engaged toggle | Toggle engaged on/off with one button (Toggle Disguise Boolean action action; falls back to the separate engage / disengage presets). | `transportManager:default` | `object.engaged` | `engaged` | toggle |
| Current track name | User-visible name of the track currently loaded in the transport - the 'NOW PLAYING' label. Mirrors the OSC module's trackname variable. | `transportManager:default` | `object.track.description` | `trackname` | readout |
| Section count | Number of sections in the current track (denominator for 'cue 3 / 12' displays). | `transportManager:default` | `object.track.nSections()` | `sectionCount` | readout |
| Chase status | Timecode / chase status message as shown under the transport manager's timecode readout (after 'Forced' timecode-mode overrides). Usually… | `transportManager:default` | `object.statusString` | `transportStatus` | readout |
| TC status (raw) | Raw timecode status before timecode-mode overrides, including pre-roll info - the best 'TC LOCK' indicator text available. | `transportManager:default` | `object.tcStatusString` | `tcStatus` | readout |
| Pre-roll countdown | Seconds until playback while timecode is pre-rolling. | `transportManager:default` | `object.preRollMatch` | `preRollSec` | readout |
| Incoming timecode | Raw incoming timecode clock value as a string (the transport manager's large timecode readout). | `transportManager:default` | `(object.timecode.current.__str__() if object.timecode is not None else "")` | `tcIncoming` | readout |
| TC source status | Status string of the timecode transport itself (receiver-side status). | `transportManager:default` | `(object.timecode.statusString if object.timecode is not None else "")` | `tcSourceStatus` | readout |
| Track position (seconds) | Playhead converted to seconds through the current track's tempo map (correct when bpm != 60). Mirrors the OSC module's trackposition… | `transportManager:default` | `object.track.beatToTime(object.player.tRender)` | `trackposition` | readout |
| Timecode position | Playhead as a timecode string (HH:MM:SS:FF) matched against the track's TC tags, like Designer's own timecode readout. Mirrors the OSC… | `transportManager:default` | `object.beatToTimecode(object.player.tRender).__str__()` | `timecodeposition` | readout |
| Free running | Possibly true when the player is free-running rather than chasing an external clock (semantics guessed from the name). | `transportManager:default` | `object.player.isFreeRunning` | `isFreeRunning` | readout |
| BPM at playhead | Tempo at the playhead (varies per section on quantised tracks). Mirrors the OSC module's bpm variable. | `transportManager:default` | `object.track.bpmAt(object.player.tRender)` | `bpm` | readout |
| Current section number | Index of the section the playhead is in (0-based from Designer; displayed +1). | `transportManager:default` | `object.track.beatToSection(object.player.tRender)` | `sectionIndex` | readout |
| Current section name | Note at the start of the current section - Designer's own 'current section name' expression. Mirrors the OSC module's currentSectionName… | `transportManager:default` | `object.track.noteAtBeat(object.track.sectionToBeat(object.track.beatToSection(object.player.tRender)))` | `currentSectionName` | readout |
| Next section name | Note at the start of the NEXT section ('what is the next cue'). Mirrors the OSC module's nextSectionName variable. | `transportManager:default` | `object.track.noteAtBeat(object.track.sectionToBeat(object.track.beatToSection(object.player.tRender) + 1))` | `nextSectionName` | readout |
| Section remaining (beats) | Beats remaining until the end of the current section (countdown to the hold / next cue). Mirrors the OSC module's sectionRemaining variable. | `transportManager:default` | `object.track.tLastBeatInSection(object.player.tRender) - object.player.tRender` | `sectionRemaining` | readout |
| Section elapsed (beats) | Beats elapsed since the start of the current section. Mirrors the OSC module's sectionElapsed variable. | `transportManager:default` | `object.player.tRender - object.track.sectionToBeat(object.track.beatToSection(object.player.tRender))` | `sectionElapsed` | readout |
| Set list track names | Names of all tracks in the active set list (JSON array) - lets a page label next / prev track buttons. | `transportManager:default` | `[t.description for t in object.setList.tracks]` | `setListTracks` | readout |
| Active layer count | Number of layers currently active under the playhead - an 'is anything rendering' sanity light. | `transportManager:default` | `len(object.player.activeLayers)` | `activeLayerCount` | readout |
| Playhead (GUI transport) | Alternative object path that follows whichever transport manager is currently active in the d3State bar (GuiSystem.player). | `subsystem:GuiSystem` | `object.player.tRender` | `guiPlayheadBeats` | readout |
| Current track length (beats) | Length of the track loaded in the transport; denominator for a playhead/length display. | `transportManager:default` | `object.track.lengthInBeats` | `currentTrackLengthBeats` | readout |

### 05 Track & Layer

> Fill these selections in first (connection settings > Selections, or the "Set selection" action): selTrack = track name as shown in Designer (quoted automatically, e.g. Track 1); selLayer = layer name inside that track (Layer editor name, e.g. Video 1); selSection = 0-based section index for the section presets; selBeat = a track beat (float) for the note/beat presets; selLayerIndex = 0-based position in the track layer list for the "(by index)" presets. Readouts show: track name/length/BPM, section and layer counts, section start/end, note at beat, beat-to-time, cue count, TC adjust, and per-layer name / enabled / live / start / end / length / anchored plus the key-0 values of pos.x, pos.y, scale and brightness. Readouts are grey; the TC-adjust knob presets (amber) write to Designer. All values are track beats unless labelled time. Also included after the live run: layer name list, section table / note / length / start (s), section of a beat, cue tags at a beat, the cue table (beat, note, section flag), layer extents / crashed / dormant / fields / key times, patched brightness, brightness at a beat, all pos.x keys and the video key-0 resource. Still experimental (99): the text key (needs a Text layer).

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Track name | Sanity probe that track:"$(liveupdate:selTrack)" resolved; shows the user-visible track name. | `track:"$(liveupdate:selTrack)"` | `object.description` | `selectedTrackName` | readout |
| Track length (beats) | Track length in beats. | `track:"$(liveupdate:selTrack)"` | `object.lengthInBeats` | `trackLengthBeats` | readout |
| Track length (time) | Track length in seconds shown as hh:mm:ss. | `track:"$(liveupdate:selTrack)"` | `object.lengthInSec` | `trackLengthSec` | readout |
| Track BPM | Base BPM of the inspected track. | `track:"$(liveupdate:selTrack)"` | `object.bpm` | `trackBpm` | readout |
| Section count | Number of sections in the track (upper bound for $(liveupdate:selSection)). | `track:"$(liveupdate:selTrack)"` | `object.nSections()` | `trackNSections` | readout |
| Layer count | Number of top-level layers on the track. | `track:"$(liveupdate:selTrack)"` | `object.nLayers()` | `trackNLayers` | readout |
| Section start (beats) | First beat of section $(liveupdate:selSection) (0-based). | `track:"$(liveupdate:selTrack)"` | `object.sectionInfo($(liveupdate:selSection)).tStart` | `sectionStartBeats` | readout |
| Section end (beats) | Last beat of section $(liveupdate:selSection) (0-based). | `track:"$(liveupdate:selTrack)"` | `object.sectionInfo($(liveupdate:selSection)).tEnd` | `sectionEndBeats` | readout |
| Note at beat | Cue note text at beat $(liveupdate:selBeat) (empty string when no note). | `track:"$(liveupdate:selTrack)"` | `object.noteAtBeat($(liveupdate:selBeat))` | `noteAtBeat` | readout |
| Beat to time | Converts beat $(liveupdate:selBeat) of the inspected track to seconds (hh:mm:ss). | `track:"$(liveupdate:selTrack)"` | `object.beatToTime($(liveupdate:selBeat))` | `beatToSec` | readout |
| TC adjust readout | Timecode-chase offset of the track (positive = play earlier). | `track:"$(liveupdate:selTrack)"` | `object.tc_adjust` | `trackTcAdjust` | readout |
| TC adjust +0.1 (knob) | Nudge tc_adjust up by 0.1; rotary right/left = +/-0.1. | `track:"$(liveupdate:selTrack)"` | `object.tc_adjust` | `trackTcAdjust` | nudge (Set to Disguise Number) |
| TC adjust -0.1 | Nudge tc_adjust down by 0.1. | `track:"$(liveupdate:selTrack)"` | `object.tc_adjust` | `trackTcAdjust` | nudge (Set to Disguise Number) |
| TC adjust reset 0 | Set tc_adjust back to 0. | `track:"$(liveupdate:selTrack)"` | `object.tc_adjust` | `trackTcAdjust` | set value |
| Layer name | Sanity probe that the findLayerByName object path resolved; echoes the layer name. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.name` | `layerName` | readout |
| Layer enabled | Enable flag of the layer; green when enabled. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.enabled` | `layerEnabled` | readout |
| Layer live (incl. parents) | True only when the layer and all parent groups are enabled: the honest "is this layer live" light. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.enabledIncludingParents` | `layerLive` | readout |
| Layer start (beats) | Layer start in track beats. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tStart` | `layerTStart` | readout |
| Layer end (beats) | Layer end in track beats (read-only; moves with tStart/tLength). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tEnd` | `layerTEnd` | readout |
| Layer length (beats) | Layer length in track beats. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tLength` | `layerTLength` | readout |
| Layer anchored | Whether the layer is anchored (anchored layers reject tStart/tLength sets). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.anchored` | `layerAnchored` | readout |
| Layer pos.x (key 0) | First X-position keyframe value of the layer. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.x").sequence.key(0).v` | `keyPosX` | readout |
| Layer pos.y (key 0) | First Y-position keyframe value of the layer. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.y").sequence.key(0).v` | `keyPosY` | readout |
| Layer scale.x (key 0) | First scale.x keyframe value of the layer. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.x").sequence.key(0).v` | `keyScale` | readout |
| Layer scale.y (key 0) | First scale.y keyframe value of the layer. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.y").sequence.key(0).v` | `keyScaleY` | readout |
| Layer brightness (key 0) | First brightness keyframe value: the most useful per-layer knob readback. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").sequence.key(0).v` | `keyBrightness` | readout |
| Brightness is constant | True when brightness is a single constant (not keyframe-animated). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").disableSequencing` | `brightnessConstant` | readout |
| Layer name (by index) | Name of layer number $(liveupdate:selLayerIndex) (0-based position in the track layer list). | `track:"$(liveupdate:selTrack)".layers[$(liveupdate:selLayerIndex)]` | `object.name` | `idxLayerName` | readout |
| pos.x key 0 (by index) | pos.x key 0 of layer number $(liveupdate:selLayerIndex) (0-based position in the track layer list). | `track:"$(liveupdate:selTrack)".layers[$(liveupdate:selLayerIndex)]` | `object.findSequence("pos.x").sequence.key(0).v` | `idxKeyPosX` | readout |
| Layer names (list) | Names of all top-level layers as a JSON array (doc-verified comprehension; experimental only because it is a comprehension). | `track:"$(liveupdate:selTrack)"` | `[l.name for l in object.layers]` | `trackLayerNames` | readout |
| Layer start via comprehension | Fallback layer-by-name route if findLayerByName is rejected: filtered comprehension on object.layers. | `track:"$(liveupdate:selTrack)"` | `[l for l in object.layers if l.name == "$(liveupdate:selLayer)"][0].tStart` | `layerTStartByComp` | readout |
| Section table (JSON) | Per-section table: index, start/end beat, length, note at start, start seconds. | `track:"$(liveupdate:selTrack)"` | `[{"i": i, "start": object.sectionInfo(i).tStart, "end": object.sectionInfo(i).tEnd, "lengthBeats": object.sectionLengthBeats(i), "note": object.noteAtBeat(object.sectionInfo(i).tStart), "startSec": object.beatToTime(object.sectionInfo(i).tStart)} for i in range(object.nSections())]` | `trackSectionTable` | readout |
| Section note | Note text at the start of section $(liveupdate:selSection) (nested composite of two doc-verified members). | `track:"$(liveupdate:selTrack)"` | `object.noteAtBeat(object.sectionInfo($(liveupdate:selSection)).tStart)` | `sectionNote` | readout |
| Section length (beats) | Length of section $(liveupdate:selSection) in beats. | `track:"$(liveupdate:selTrack)"` | `object.sectionLengthBeats($(liveupdate:selSection))` | `sectionLengthBeats` | readout |
| Section start (time) | Start of section $(liveupdate:selSection) in seconds (hh:mm:ss). | `track:"$(liveupdate:selTrack)"` | `object.beatToTime(object.sectionInfo($(liveupdate:selSection)).tStart)` | `sectionStartSec` | readout |
| Section index at beat | Index of the section containing beat $(liveupdate:selBeat). | `track:"$(liveupdate:selTrack)"` | `object.beatToSection($(liveupdate:selBeat))` | `sectionAtBeat` | readout |
| CUE number at beat | CUE-number tag text at beat $(liveupdate:selBeat), guarded against None. | `track:"$(liveupdate:selTrack)"` | `(object.tagAtBeat($(liveupdate:selBeat), 1).text if object.tagAtBeat($(liveupdate:selBeat), 1) else "")` | `cueNumberAtBeat` | readout |
| Tags at beat (JSON) | All tags (type 1=CUE, 0=TC, 2=MIDI) at beat $(liveupdate:selBeat). | `track:"$(liveupdate:selTrack)"` | `[{"type": t.type, "text": t.text} for t in object.tagsAtBeat($(liveupdate:selBeat))]` | `tagsAtBeat` | readout |
| Cue table (JSON) | Cue table: beat, note and is-section flag for every cue (JSON array). | `track:"$(liveupdate:selTrack)"` | `[{"beat": object.cues.getT(i), "note": object.cues.getV(i).note, "section": object.cues.getV(i).section} for i in range(object.cues.n())]` | `trackCueTable` | readout |
| Layer summary (JSON) | One-shot {name,start,end,length,enabled} summary of the layer. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `{"name": object.name, "start": object.tStart, "end": object.tEnd, "length": object.tLength, "enabled": object.enabledIncludingParents}` | `layerExtents` | readout |
| Layer crashed | Layer crashed flag (pyi member without docstring); red when true. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.crashed` | `layerCrashed` | readout |
| Layer dormant | isDormant flag (undocumented meaning). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.isDormant` | `layerDormant` | readout |
| Layer fields (JSON) | Discovery helper: decorated field names usable in findSequence, UI names, types, sequenced/patched flags. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `[{"name": f.name, "user": f.userName, "type": f.typeName, "sequenced": not f.disableSequencing, "patched": f.isPatched} for f in object.fields]` | `layerFields` | readout |
| Layer keyframe beats (JSON) | All keyframe beats on the layer. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.keyTimes()` | `layerKeyTimes` | readout |
| pos.x all keys (JSON) | All pos.x keyframes as [{t,v}] (doc-verbatim comprehension, name-based layer path). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `[{"t": object.findSequence("pos.x").sequence.key(i).localT, "v": object.findSequence("pos.x").sequence.key(i).v} for i in range(object.findSequence("pos.x").sequence.nKeys())]` | `keyPosXAll` | readout |
| Brightness patched | True when brightness is expression/sockpuppet controlled (the key-0 knob is then overridden). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").isPatched` | `brightnessPatched` | readout |
| Brightness at beat | Sequenced brightness value at beat $(liveupdate:selBeat) rendered as a string (sequencing only, not external control). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").sequence.evalString($(liveupdate:selBeat))` | `brightnessAtBeat` | readout |
| Video clip (key 0) | Media resource on a video layer's first key; shows the clip path. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("video").sequence.key(0).r` | `keyVideo` | readout |

### 06 Layer Control

> Requires selection variable(s) selTrack and selLayer (and selLayerIndex for the "(by index)" presets), see 05 Track & Layer. Presets: layer enable (green) / disable (red) / toggle, layer start and length nudges and sets (amber), keyframe key-0 nudges and sets for pos.x, pos.y, scale and brightness (amber, "(knob)" presets also drive rotary left/right when rotaryActions is on), brightness = 0 black, and brightness "constant" on/off (disableSequencing). Each control also subscribes to its own value so the button shows the live number. Anchored layers reject start/length changes; only key 0 is changed, later keyframes still play. Sets are persistent and undoable in Designer.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Layer enable | Enable the layer (setToDisguiseBoolean true). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.enabled` | `layerEnabled` | set on/off |
| Layer disable | Disable the layer (setToDisguiseBoolean false). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.enabled` | `layerEnabled` | set on/off |
| Layer enable toggle | Toggle the layer enable flag (Toggle Disguise Boolean action); green while enabled. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.enabled` | `layerEnabled` | toggle |
| Layer start +1 beat (knob) | Move the layer start later by one beat; rotary right/left = +/-1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tStart` | `layerTStart` | nudge (Set to Disguise Number) |
| Layer start -1 beat | Move the layer start earlier by one beat. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tStart` | `layerTStart` | nudge (Set to Disguise Number) |
| Layer length +1 beat (knob) | Lengthen the layer by one beat; rotary right/left = +/-1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tLength` | `layerTLength` | nudge (Set to Disguise Number) |
| Layer length -1 beat | Shorten the layer by one beat. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.tLength` | `layerTLength` | nudge (Set to Disguise Number) |
| Layer Pos X +1 (knob) | Nudge pos.x key 0 up by 1; rotary right/left = +/-1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.x").sequence.key(0).v` | `keyPosX` | nudge (Set to Disguise Number) |
| Layer Pos X -1 | Nudge pos.x key 0 down by 1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.x").sequence.key(0).v` | `keyPosX` | nudge (Set to Disguise Number) |
| Layer Pos X = 0 | Set pos.x key 0 to 0 (setToDisguiseNumber literal). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.x").sequence.key(0).v` | `keyPosX` | set value |
| Layer Pos Y +1 (knob) | Nudge pos.y key 0 up by 1; rotary right/left = +/-1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.y").sequence.key(0).v` | `keyPosY` | nudge (Set to Disguise Number) |
| Layer Pos Y -1 | Nudge pos.y key 0 down by 1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.y").sequence.key(0).v` | `keyPosY` | nudge (Set to Disguise Number) |
| Layer Pos Y = 0 | Set pos.y key 0 to 0 (setToDisguiseNumber literal). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("pos.y").sequence.key(0).v` | `keyPosY` | set value |
| Layer Scale X +0.1 (knob) | Nudge scale.x key 0 up by 0.1; rotary right/left = +/-0.1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.x").sequence.key(0).v` | `keyScale` | nudge (Set to Disguise Number) |
| Layer Scale Y +0.1 (knob) | Nudge scale.y key 0 up by 0.1; rotary right/left = +/-0.1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.y").sequence.key(0).v` | `keyScaleY` | nudge (Set to Disguise Number) |
| Layer Scale X -0.1 | Nudge scale.x key 0 down by 0.1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.x").sequence.key(0).v` | `keyScale` | nudge (Set to Disguise Number) |
| Layer Scale Y -0.1 | Nudge scale.y key 0 down by 0.1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.y").sequence.key(0).v` | `keyScaleY` | nudge (Set to Disguise Number) |
| Layer Scale X = 1 | Set scale.x key 0 to 1 (setToDisguiseNumber literal). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.x").sequence.key(0).v` | `keyScale` | set value |
| Layer Scale Y = 1 | Set scale.y key 0 to 1 (setToDisguiseNumber literal). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("scale.y").sequence.key(0).v` | `keyScaleY` | set value |
| Layer Bright +0.1 (knob) | Nudge brightness key 0 up by 0.1; rotary right/left = +/-0.1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").sequence.key(0).v` | `keyBrightness` | nudge (Set to Disguise Number) |
| Layer Bright -0.1 | Nudge brightness key 0 down by 0.1. | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").sequence.key(0).v` | `keyBrightness` | nudge (Set to Disguise Number) |
| Layer Bright = 1 | Set brightness key 0 to 1 (setToDisguiseNumber literal). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").sequence.key(0).v` | `keyBrightness` | set value |
| Layer Bright = 0 (black) | Set brightness key 0 to 0 (fully transparent in alpha mode). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").sequence.key(0).v` | `keyBrightness` | set value |
| Brightness constant ON | Set disableSequencing = true on brightness so key 0 acts as a constant (guide recipe). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").disableSequencing` | `brightnessConstant` | set on/off |
| Brightness constant OFF | Set disableSequencing = false (brightness follows its keyframes again). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("brightness").disableSequencing` | `brightnessConstant` | set on/off |

### 07 Stage & Screen

> Fill these selections in before dropping the presets (connection settings > Selections, or the "Set selection" action): selScreen = exact Designer name of the Surface (Screen2), e.g. Surface 1 (the presets add the quotes); selProjector = projector name, e.g. projector 1; selScreenUid = UID of any display copied from its editor title bar (right-click > Copy UID), including the 0x prefix - the "Display (UID)" presets work for LED and DMX screens too. Readouts: surface name, mesh and resolution, health flags, offset and rotation, master fade, hold output, render layer (on/off stage), the projectors of a surface and the surfaces of a projector; projector name, resolution and master fade. Controls (amber = write, green = on/enable, red = off/hold): offset X/Y/Z nudges and reset, master fade nudges and 1.0 / 0.0, hold ON/OFF/toggle, ON/OFF stage - for the surface, for the projector and for any display addressed by UID. Sets are undoable in Designer and persist in the project. Nudge presets also respond to rotary encoders (right = +, left = -). Also included after the live run: the projectors of a surface, the surfaces of a projector, LED screen name / fade / hold / offset (selection selLedScreen = LED screen name) and stage display count / dynamic blend (selection selStageUid = Stage UID, hex with 0x prefix). Still experimental (99): DMX screen rows (no DMX screen in the test project) and the stage venue name (no venue assigned).

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Screen name | User-visible name of the Surface; confirms that $(liveupdate:selScreen) resolved. | `screen2:"$(liveupdate:selScreen)"` | `object.description` | `screenName` | readout |
| Screen in error | Resource health: bad, incomplete or not found locally. | `screen2:"$(liveupdate:selScreen)"` | `object.isInError` | `screenInError` | readout |
| Screen in active stage | Whether the surface belongs to the active stage. | `screen2:"$(liveupdate:selScreen)"` | `object.isInActiveStage()` | `screenInActiveStage` | readout |
| Screen offset XYZ | Surface position in metres relative to its parent (Vec as JSON). | `screen2:"$(liveupdate:selScreen)"` | `object.offset` | `screenOffset` | readout |
| Screen offset reset 0,0,0 | Move the surface back to its parent origin with one documented partial-JSON set. | `screen2:"$(liveupdate:selScreen)"` | `object.offset` | `screenOffset` | set JSON |
| Screen offset X | Surface position X in metres relative to its parent. | `screen2:"$(liveupdate:selScreen)"` | `object.offset.x` | `screenOffsetX` | readout |
| Screen X +0.1 m | Nudge surface X by +0.1 m (rotary: right = +, left = -). | `screen2:"$(liveupdate:selScreen)"` | `object.offset.x` | `screenOffsetX` | nudge (Set to Disguise Number) |
| Screen X -0.1 m | Nudge surface X by -0.1 m (rotary: right = +, left = -). | `screen2:"$(liveupdate:selScreen)"` | `object.offset.x` | `screenOffsetX` | nudge (Set to Disguise Number) |
| Screen rotation XYZ | Euler rotation of the surface in degrees relative to its parent. | `screen2:"$(liveupdate:selScreen)"` | `object.rotation` | `screenRotation` | readout |
| Screen master fade | Output brightness of the screen (0..1, applied at Feed level, not shown in the visualiser). | `screen2:"$(liveupdate:selScreen)"` | `object.master_fade` | `screenMasterFade` | readout |
| Screen fade +0.05 | Raise master fade by 0.05 (rotary: right = up, left = down). | `screen2:"$(liveupdate:selScreen)"` | `object.master_fade` | `screenMasterFade` | nudge (Set to Disguise Number) |
| Screen fade -0.05 | Lower master fade by 0.05 (rotary: right = up, left = down). | `screen2:"$(liveupdate:selScreen)"` | `object.master_fade` | `screenMasterFade` | nudge (Set to Disguise Number) |
| Screen fade 1.0 | Set master fade to full brightness. | `screen2:"$(liveupdate:selScreen)"` | `object.master_fade` | `screenMasterFade` | set value |
| Screen fade 0.0 | Black out this display at the Feed output (content keeps running). | `screen2:"$(liveupdate:selScreen)"` | `object.master_fade` | `screenMasterFade` | set value |
| Screen hold output | Whether the screen output is frozen (per-display Hold). | `screen2:"$(liveupdate:selScreen)"` | `object.holdOutput` | `screenHoldOutput` | readout |
| Screen hold ON | Freeze this display output while sequencing continues. | `screen2:"$(liveupdate:selScreen)"` | `object.holdOutput` | `screenHoldOutput` | set on/off |
| Screen hold OFF | Release the per-display Hold. | `screen2:"$(liveupdate:selScreen)"` | `object.holdOutput` | `screenHoldOutput` | set on/off |
| Screen hold toggle | Toggle the per-display Hold with one button (needs the Toggle Disguise Boolean action action). | `screen2:"$(liveupdate:selScreen)"` | `object.holdOutput` | `screenHoldOutput` | toggle |
| Screen render layer | Where the surface renders: Off stage / On stage / Frontplate / Backplate / Set Extension mask / Set Extension addition / Live action volume… | `screen2:"$(liveupdate:selScreen)"` | `object.renderLayer` | `screenRenderLayer` | readout |
| Screen ON stage | Put the surface back on stage (renderLayer = 1). | `screen2:"$(liveupdate:selScreen)"` | `object.renderLayer` | `screenRenderLayer` | set value |
| Screen OFF stage | Remove the surface from all outputs (renderLayer = 0). | `screen2:"$(liveupdate:selScreen)"` | `object.renderLayer` | `screenRenderLayer` | set value |
| Screen tracking live | True while position/rotation data arrives from the assigned tracking source (tracking-loss alarm). | `screen2:"$(liveupdate:selScreen)"` | `object.isReceivingFromTrackingSource` | `screenTrackingLive` | readout |
| Projector name | Projector name; confirms that $(liveupdate:selProjector) resolved. | `projector:"$(liveupdate:selProjector)"` | `object.description` | `projectorName` | readout |
| Projector in error | Resource health of the projector (bad, incomplete or not found locally). | `projector:"$(liveupdate:selProjector)"` | `object.isInError` | `projectorInError` | readout |
| Projector has feed | Whether the projector has a feed rectangle assigned. | `projector:"$(liveupdate:selProjector)"` | `object.hasFeedAssigned()` | `projectorHasFeed` | readout |
| Projector master fade | Output brightness of the projector (0..1, applied at Feed level, not shown in the visualiser). | `projector:"$(liveupdate:selProjector)"` | `object.master_fade` | `projectorMasterFade` | readout |
| Projector fade +0.05 | Raise master fade by 0.05 (rotary: right = up, left = down). | `projector:"$(liveupdate:selProjector)"` | `object.master_fade` | `projectorMasterFade` | nudge (Set to Disguise Number) |
| Projector fade -0.05 | Lower master fade by 0.05 (rotary: right = up, left = down). | `projector:"$(liveupdate:selProjector)"` | `object.master_fade` | `projectorMasterFade` | nudge (Set to Disguise Number) |
| Projector fade 1.0 | Set master fade to full brightness. | `projector:"$(liveupdate:selProjector)"` | `object.master_fade` | `projectorMasterFade` | set value |
| Projector fade 0.0 | Black out this display at the Feed output (content keeps running). | `projector:"$(liveupdate:selProjector)"` | `object.master_fade` | `projectorMasterFade` | set value |
| Projector hold output | Whether the projector output is frozen (per-display Hold). | `projector:"$(liveupdate:selProjector)"` | `object.holdOutput` | `projectorHoldOutput` | readout |
| Projector hold ON | Freeze this display output while sequencing continues. | `projector:"$(liveupdate:selProjector)"` | `object.holdOutput` | `projectorHoldOutput` | set on/off |
| Projector hold OFF | Release the per-display Hold. | `projector:"$(liveupdate:selProjector)"` | `object.holdOutput` | `projectorHoldOutput` | set on/off |
| Projector hold toggle | Toggle the per-display Hold with one button (needs the Toggle Disguise Boolean action action). | `projector:"$(liveupdate:selProjector)"` | `object.holdOutput` | `projectorHoldOutput` | toggle |
| Display (UID) name | Name of the display addressed by UID; confirms that $(liveupdate:selScreenUid) points at the right object. | `getByUID($(liveupdate:selScreenUid))` | `object.description` | `uidName` | readout |
| Display (UID) master fade | Output brightness of the display addressed by UID (0..1, applied at Feed level, not shown in the visualiser). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | readout |
| Display (UID) fade +0.05 | Raise master fade by 0.05 (rotary: right = up, left = down). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | nudge (Set to Disguise Number) |
| Display (UID) fade -0.05 | Lower master fade by 0.05 (rotary: right = up, left = down). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | nudge (Set to Disguise Number) |
| Display (UID) fade 1.0 | Set master fade to full brightness. | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | set value |
| Display (UID) fade 0.0 | Black out this display at the Feed output (content keeps running). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | set value |
| Display (UID) hold output | Whether the display addressed by UID is frozen (per-display Hold). | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | readout |
| Display (UID) hold ON | Freeze this display output while sequencing continues. | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | set on/off |
| Display (UID) hold OFF | Release the per-display Hold. | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | set on/off |
| Display (UID) hold toggle | Toggle the per-display Hold with one button (needs the Toggle Disguise Boolean action action). | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | toggle |
| Screen projectors (list) | Names of the projectors assigned to the surface (JSON array). | `screen2:"$(liveupdate:selScreen)"` | `[p.description for p in object.projectors]` | `screenProjectors` | readout |
| Projector screens (list) | Names of the surfaces this projector renders (JSON array). | `projector:"$(liveupdate:selProjector)"` | `[s.description for s in object.screens]` | `projectorScreens` | readout |
| LED screen name | Name of the LED screen; proves whether the ledscreen: prefix resolves. | `ledscreen:"$(liveupdate:selLedScreen)"` | `object.description` | `ledName` | readout |
| LED screen master fade | Output brightness of the LED screen (0..1), read-only until the prefix is confirmed. | `ledscreen:"$(liveupdate:selLedScreen)"` | `object.master_fade` | `ledMasterFade` | readout |
| LED screen hold output | Whether the LED screen output is frozen. | `ledscreen:"$(liveupdate:selLedScreen)"` | `object.holdOutput` | `ledHoldOutput` | readout |
| LED screen offset XYZ | LED screen position in metres (kinetic LED may be tracking-driven). | `ledscreen:"$(liveupdate:selLedScreen)"` | `object.offset` | `ledOffset` | readout |
| Stage display count | Number of display surfaces on the stage. | `getByUID($(liveupdate:selStageUid))` | `object.nDisplays()` | `stageDisplayCount` | readout |
| Stage dynamic blend master | Stage-wide Dynamic Blend master switch. | `getByUID($(liveupdate:selStageUid))` | `object.autoSoftEdge` | `stageDynBlend` | readout |
| Display (UID) render layer | Render layer of any display addressed by UID (0 Off stage, 1 On stage, 2 Frontplate, 3 Backplate...). | `getByUID($(liveupdate:selScreenUid))` | `object.renderLayer` | `uidRenderLayer` | readout |
| Display (UID) ON stage | Set renderLayer = 1 (On stage) on the UID-addressed display. | `getByUID($(liveupdate:selScreenUid))` | `object.renderLayer` | `uidRenderLayer` | set value |
| Display (UID) OFF stage | Set renderLayer = 0 (Off stage) on the UID-addressed display. | `getByUID($(liveupdate:selScreenUid))` | `object.renderLayer` | `uidRenderLayer` | set value |
| Display (UID) in error | Resource health flag (bad, incomplete or not found) of the UID-addressed display. | `getByUID($(liveupdate:selScreenUid))` | `object.isInError` | `uidInError` | readout |
| Projector in active stage | A projector outside the active stage outputs nothing. | `projector:"$(liveupdate:selProjector)"` | `object.isInActiveStage()` | `projectorInActiveStage` | readout |

### 08 Expression Variables

> Expression Variables device readouts. Fill these selections in first (connection settings > Selections, or the "Set selection" action): selEvUid = the device UID as an unquoted hex literal (Designer: right-click the Expression Variables device editor title bar > Copy UID, e.g. 0x0123456789abcdef); selEvIndex = zero-based row index of the variable in the device editor (plain integer, no quotes; rows can be drag-reordered so re-check after edits). Presets in this category read the i-th variable through getByUID(selEvUid).container.variables[selEvIndex]: defaultFloat (value of a Float variable), defaultString (value of a String variable), name and type (0 Float, 1 String, 2 Function). The readouts are read-only. Two knobs (EV float +/-0.1) write defaultFloat through the list subscript; that write is the one part of this category that could not be tested on the verification rig, because the test project had no Expression Variables device. Try them on a spare variable before using them in a show. Experimental rows (see 99 Experimental) additionally need selEvDevice (device name = filename part of objects/ExpressionVariablesDevice/<name>.apx), selEvName (variable name, case-sensitive) and selEvLayer (name of an ExpressionVariables layer currently under the playhead). None of the Expression Variables rows could be checked live: the test project has no Expression Variables device.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| EV float by UID+index | Show the value of the i-th Float-type expression variable on the device addressed by UID (rename-proof). | `getByUID($(liveupdate:selEvUid))` | `object.container.variables[$(liveupdate:selEvIndex)].defaultFloat` | `evFloat` | readout |
| EV string by UID+index | Show the value of the i-th String-type expression variable (e.g. text fed to a text layer) on the device addressed by UID. | `getByUID($(liveupdate:selEvUid))` | `object.container.variables[$(liveupdate:selEvIndex)].defaultString` | `evString` | readout |
| EV name by UID+index | Show the name of the i-th variable; cheapest smoke test that getByUID resolves the device and the index is right. | `getByUID($(liveupdate:selEvUid))` | `object.container.variables[$(liveupdate:selEvIndex)].name` | `evName` | readout |
| EV type by UID+index | Show whether the i-th variable is Float, String or Function so the operator knows which value readout applies. | `getByUID($(liveupdate:selEvUid))` | `object.container.variables[$(liveupdate:selEvIndex)].type` | `evType` | readout |
| EV device name (by UID) | Index-independent smoke test that selEvUid points at the intended device. | `getByUID($(liveupdate:selEvUid))` | `object.description` | `evDeviceName` | readout |
| EV float +0.1 (by UID+index) | Nudge the selected float expression variable up by 0.1. | `getByUID($(liveupdate:selEvUid))` | `object.container.variables[$(liveupdate:selEvIndex)].defaultFloat` | `evFloat` | nudge (Set to Disguise Number) |
| EV float -0.1 (by UID+index) | Nudge the selected float expression variable down by 0.1. | `getByUID($(liveupdate:selEvUid))` | `object.container.variables[$(liveupdate:selEvIndex)].defaultFloat` | `evFloat` | nudge (Set to Disguise Number) |

### 09 RenderStream

> RenderStream presets read subsystem:RenderStreamSystem (cluster/instance health, per-node flags, receive statuses, active latency) and Machine takeover. Fill these selections in first (connection settings > Selections, or the "Set selection" action): selWorkload = workload ID as a Python int - copy it from the Cluster Workload widget ('Copy UID') or from REST GET /api/session/renderstream/layers then GET /api/session/renderstream/layerstatus?uid=<layer uid> (workload.uid); if the copied value is hex, enter it as 0x...; selInstance = zero-based instance index inside the workload (0 = first render node); selMachine = render node / machine name exactly as shown in the Cluster Workload widget Instances > Machine column. The 'RS workload layer count' preset shows how many layers carry a workload (on r34.0.3 the id map itself serialises empty, so read ids through the RS Layer Workload ID preset). The layer-route presets (RS Layer ...) need selTrack (track name) and selRsLayer (zero-based index of the RenderStream layer among the track's RenderStream leaf layers); the RS Layer Workload ID preset shows the workload id as text ready for selWorkload. The aggregate rows (node summary, running count, any dropping / down, health list, min FPS, max latency, dropped total, all subscribed, last errors, status messages) were verified live with a workload that had no running instances. All RenderStream rows are read-only; workload start/stop/restart is only available through the REST session API, not LiveUpdate. While a workload has no running instances the per-instance rows show PATH_ERROR (the Director answers "out of range error accessing workload instance"); the module backs off and retries on its own.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| RS Subsystem Enabled | Sanity indicator that subsystem:RenderStreamSystem resolves and RenderStream is enabled on the Director. | `subsystem:RenderStreamSystem` | `object.isEnabled` | `rsEnabled` | readout |
| RS Licensing State | RenderStream licensing/auth state; shows FULL when the code equals RS_AUTH_MODE_FULL (2), otherwise the raw code. | `subsystem:RenderStreamSystem` | `object.getLicensingState()` | `rsLicensingState` | readout |
| RS Active Latency | Session-level RenderStream active latency figure (units undocumented). | `subsystem:RenderStreamSystem` | `object.activeLatency()` | `rsActiveLatency` | readout |
| RS workload layer count | Number of layers that carry a RenderStream workload (len of RenderStreamSystem.getWorkloadLayers()). | `subsystem:RenderStreamSystem` | `len(object.getWorkloadLayers())` | `rsWorkloadLayers` | readout |
| RS Workload Instances | Documented core expression: all instances (one per render node) of the workload with process/drop/latency flags; button lists the node… | `subsystem:RenderStreamSystem` | `object.getWorkloadInstances($(liveupdate:selWorkload))` | `rsWorkloadInstances` | readout |
| RS Workload Receive Status | Documented core expression: receive statuses for every machine subscribed to the workload's streams; button lists the stream names. | `subsystem:RenderStreamSystem` | `object.getWorkloadReceiveStatuses($(liveupdate:selWorkload))` | `rsWorkloadReceiveStatuses` | readout |
| RS Node Receive Status | Documented core expression: receive statuses filtered to one render node; button shows the per-stream subscribeSuccessful flags. | `subsystem:RenderStreamSystem` | `object.getStreamReceiveStatuses($(liveupdate:selWorkload), "$(liveupdate:selMachine)")` | `rsStreamReceiveStatuses` | readout |
| RS Instance Machine | Render node name behind instance selInstance, so the operator can label the health buttons. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).machineName` | `rsInstanceMachineName` | readout |
| RS Instance Running | Whether the render engine process is running on instance selInstance. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).isProcessRunning` | `rsInstanceProcessRunning` | readout |
| RS Instance Dropping Frames | Instance selInstance is dropping output frames. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).isDroppingFrames` | `rsInstanceDroppingFrames` | readout |
| RS Instance Dropping Inputs | Instance selInstance is dropping input (texture/parameter) frames. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).isDroppingInputFrames` | `rsInstanceDroppingInputFrames` | readout |
| RS Instance High Latency | High active latency detected on instance selInstance. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).isHighActiveLatencyDetected` | `rsInstanceHighLatency` | readout |
| RS Instance Unrecoverable Error | Instance selInstance hit an unrecoverable error and needs a restart (REST restartlayers). | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).unrecoverableError` | `rsInstanceUnrecoverableError` | readout |
| RS Instance Status Code | Raw numeric state code of instance selInstance (enum meanings undocumented; REST layerstatus exposes the same as a free-text 'state'). | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).status` | `rsInstanceStatus` | readout |
| RS Instance Health Message | Human-readable health message for instance selInstance; the best single string for a button label. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).health().message` | `rsInstanceHealthMessage` | readout |
| RS Instance Health Status | Numeric health status code for instance selInstance; usable for colour feedback once enum values are captured. | `subsystem:RenderStreamSystem` | `object.getWorkloadInstance($(liveupdate:selWorkload), $(liveupdate:selInstance)).health().status` | `rsInstanceHealthStatus` | readout |
| RS Nodes Summary | One-line cluster overview: each render node with RUN/OFF/ERR. | `subsystem:RenderStreamSystem` | `" \| ".join([i.machineName + (":ERR" if i.unrecoverableError else (":RUN" if i.isProcessRunning else ":OFF")) for i in object.getWorkloadInstances($(liveupdate:selWorkload))])` | `rsInstancesSummary` | readout |
| RS Running / Total | Running/total instance count for the workload, e.g. 4/4. | `subsystem:RenderStreamSystem` | `"%d/%d" % (len([i for i in object.getWorkloadInstances($(liveupdate:selWorkload)) if i.isProcessRunning]), len(object.getWorkloadInstances($(liveupdate:selWorkload))))` | `rsInstancesRunningCount` | readout |
| RS Any Node Dropping | True if any render node in the workload is dropping output or input frames. | `subsystem:RenderStreamSystem` | `any([i.isDroppingFrames or i.isDroppingInputFrames for i in object.getWorkloadInstances($(liveupdate:selWorkload))])` | `rsAnyInstanceDropping` | readout |
| RS Any Node Down | True if any instance is not running or in unrecoverable error. | `subsystem:RenderStreamSystem` | `any([i.unrecoverableError or not i.isProcessRunning for i in object.getWorkloadInstances($(liveupdate:selWorkload))])` | `rsAnyInstanceDown` | readout |
| RS Health List | Per-instance machine name plus health message/status in one subscription; button lists the messages. | `subsystem:RenderStreamSystem` | `[{"machine": i.machineName, "health": i.health().message, "status": i.health().status} for i in object.getWorkloadInstances($(liveupdate:selWorkload))]` | `rsInstancesHealthList` | readout |
| RS Min Receive FPS | Lowest recent receive fps across all stream subscriptions in the workload. | `subsystem:RenderStreamSystem` | `min([s.recentReceivedFPS() for s in object.getWorkloadReceiveStatuses($(liveupdate:selWorkload))] or [0.0])` | `rsReceiveMinFps` | readout |
| RS Max Stream Latency | Worst active latency among received streams in the workload (units undocumented). | `subsystem:RenderStreamSystem` | `max([s.activeLatency for s in object.getWorkloadReceiveStatuses($(liveupdate:selWorkload))] or [0.0])` | `rsReceiveMaxLatency` | readout |
| RS Dropped Packets | Total dropped packets summed over all stream subscriptions (monotonic counter; watch for increases). | `subsystem:RenderStreamSystem` | `sum([s.totalDroppedPackets for s in object.getWorkloadReceiveStatuses($(liveupdate:selWorkload))])` | `rsReceiveDroppedTotal` | readout |
| RS All Streams Subscribed | True when every wanted stream subscription is established (green light for the receive side). | `subsystem:RenderStreamSystem` | `all([s.subscribeSuccessful for s in object.getWorkloadReceiveStatuses($(liveupdate:selWorkload)) if s.subscriptionWanted])` | `rsReceiveAllSubscribed` | readout |
| RS Stream Last Errors | Concatenated last error message per stream that has one. | `subsystem:RenderStreamSystem` | `"; ".join([s.streamIdentifier.streamName + ": " + s.tLastErrorMessage for s in object.getWorkloadReceiveStatuses($(liveupdate:selWorkload)) if s.tLastErrorMessage])` | `rsReceiveLastErrors` | readout |
| RS Stream Status Messages | Designer-generated status message per stream subscription (same text as the Cluster Workload widget). | `subsystem:RenderStreamSystem` | `[s.generateStreamStatusMsg(False).message for s in object.getWorkloadReceiveStatuses($(liveupdate:selWorkload))]` | `rsReceiveStatusMessages` | readout |
| RS Layer Workload ID | Discovery via the layer route: workload ID of the selRsLayer-th RenderStream layer on track selTrack as text (copy into selWorkload). | `track:"$(liveupdate:selTrack)"` | `str(object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.workloadId)` | `rsLayerWorkloadId` | readout |
| RS Layer Cluster Health | Cluster-level aggregated WorkloadHealth for the layer's workload - no workload ID needed; button shows the message. | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.cluster.workloadHealth` | `rsLayerClusterHealth` | readout |
| RS Layer Any Running | Any instance of the layer's workload is running. | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.cluster.anyInstanceIsRunning` | `rsLayerAnyRunning` | readout |
| RS Layer Instance Count | Number of instances in the layer's cluster (upper bound for selInstance). | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.cluster.nInstances` | `rsLayerInstanceCount` | readout |
| RS Layer Instance Health | Health message of instance selInstance via the cluster object (alternative to the subsystem route, no workload ID needed). | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.cluster.instanceHealth($(liveupdate:selInstance)).message` | `rsLayerInstanceHealthMessage` | readout |
| RS Pool Machines Online | Online render machines vs configured machines in the layer's cluster pool. | `track:"$(liveupdate:selTrack)"` | `"%d/%d online" % (len(object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.pool.getOnlineRenderMachines()), len(object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.pool.machines))` | `rsLayerPoolOnline` | readout |
| RS Asset Errors | Asset validation errors for the layer's asset against its pool (same data as REST layerstatus assetErrors). | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.pool.assetErrors(object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.asset)` | `rsLayerAssetErrors` | readout |
| RS Asset Available | Whether the layer's RenderStream asset is available anywhere on the network. | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.asset.available` | `rsLayerAssetAvailable` | readout |
| RS Framerate Fraction | Read-only view of the layer's framerate fraction (1, 1/2, 1/3, 1/4). The member has a setter but the write is inferred and therefore not… | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.framerateFraction` | `rsLayerFramerateFraction` | readout |

### 10 Failover & d3Net

> These presets read the failover / d3Net state of ONE machine addressed by name. Fill in the selection selMachine and set it to the machine's resource name exactly as it appears in Designer's d3Net Manager / Machines list (the 'name' field of GET /api/session/status/health - not necessarily the Windows hostname). Every preset here uses the object path Machine:"$(liveupdate:selMachine)"; change the selection variable(s) and all presets re-point at once (duplicate the page and use a second selection variable(s) if you need two machines side by side). Readouts: taken over a failed machine (understudy side), failed (actor side), auto failover disabled, network connected, network status code, active, role, running as, understudy targets, plus identity: machine name, hostname, IP, hardware type, d3Net node id, GUI visible, resource status. There are deliberately NO write presets in this category: role, hostname, director and understudy targets reconfigure the session, and the fail / restore machine commands are not reachable through LiveUpdate set (use REST POST /api/session/failover/failovermachine and /restoremachine). Alarm colours: add the liveUpdateCompare feedback as noted per preset (red = failed / offline / taken over / inactive, amber = auto failover disabled). Rows for the connected machine itself, the acting director, offline / failed / taken-over lists across the whole d3Net, understudy configuration, the failover timeout, network adaptors and by-hostname addressing (selection selHost, shared with 03 Monitoring Remote) were verified live and are included. Only the name of the Director's understudy stays experimental (no understudy in the test project). Values update at the state (500 ms) or static (5000 ms) rate; failover indicators are method calls that the Director may evaluate on every cycle, so do not lower them below the defaults.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Taken over failed machine | Canonical failover alarm: true when the addressed machine (an Understudy) has taken over a failed Actor. Object and property are shown… | `Machine:"$(liveupdate:selMachine)"` | `object.hasTakenOverFailedMachine()` | `machineTakenOver` | readout |
| Machine failed | Actor side of a takeover: the addressed machine is currently flagged as failed. | `Machine:"$(liveupdate:selMachine)"` | `object.failed` | `machineFailed` | readout |
| Auto failover disabled | Warns the operator that automatic failover is switched off for this machine. | `Machine:"$(liveupdate:selMachine)"` | `object.failoverDisabled` | `failoverDisabled` | readout |
| Network connected | Online indicator: whether the machine is currently connected on the d3Net network. | `Machine:"$(liveupdate:selMachine)"` | `object.networkConnected` | `networkConnected` | readout |
| Network status code | Raw integer network status of the machine for diagnosis; the enum is not documented, so the number is shown as-is. | `Machine:"$(liveupdate:selMachine)"` | `object.networkStatus` | `networkStatus` | readout |
| Machine active | Session membership indicator: whether the machine is active in the running session. | `Machine:"$(liveupdate:selMachine)"` | `object.active` | `machineActive` | readout |
| Machine role | Shows the machine's d3Net role (Director / Actor / Understudy...). Read-only on purpose: the setter reconfigures the session. | `Machine:"$(liveupdate:selMachine)"` | `object.role` | `machineRole` | readout |
| Running as | Name of the machine this machine is currently running as - on an Understudy that has taken over, the failed Actor it is impersonating (REST… | `Machine:"$(liveupdate:selMachine)"` | `object.runningAs.name` | `runningAs` | readout |
| Understudy target count | How many Actors this Understudy is configured to cover (0 = misconfigured understudy). | `Machine:"$(liveupdate:selMachine)"` | `object.targets` | `understudyTargets` | readout |
| Machine hostname | Network hostname of the machine, to cross-check selMachine against the physical box. | `Machine:"$(liveupdate:selMachine)"` | `object.hostname` | `machineHostname` | readout |
| Machine IP address | IP address of the machine as a string. | `Machine:"$(liveupdate:selMachine)"` | `object.IP_address` | `machineIp` | readout |
| Machine name | Echoes the resolved machine name; the quickest check that $(liveupdate:selMachine) resolves to a Machine. | `Machine:"$(liveupdate:selMachine)"` | `object.name` | `machineName` | readout |
| Machine hardware type | Hardware type string of the machine (e.g. 'vx 4'). | `Machine:"$(liveupdate:selMachine)"` | `object.typeName` | `machineType` | readout |
| GUI visible | Whether the Designer GUI is currently shown on that machine (REST 'guiVisible'). | `Machine:"$(liveupdate:selMachine)"` | `object.isGuiVisible` | `guiVisible` | readout |
| Resource status text | Generic Resource status string of the Machine ('The current status of the resource'); content for Machine is undocumented and may be empty. | `Machine:"$(liveupdate:selMachine)"` | `object.status()` | `machineStatusText` | readout |
| This machine name | Name of the machine evaluating the subscription (the machine Companion is connected to) without knowing it in advance. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.localMachine.name` | `localMachineName` | readout |
| This machine name (global) | Same value as fo_local_name via the module global d3NetManager inside the property expression; the object (a documented subsystem path) is… | `subsystem:MonitoringManager` | `d3NetManager.localMachine.name` | `localMachineNameAlt` | readout |
| Director name | Name of the current (acting) Director without knowing it in advance; changes when a director failover happens. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.director.name` | `directorName` | readout |
| Connected to director? | 'Am I (the connected machine) the Director?' using the equality idiom from the D3Net guide. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.director == object.d3NetManager.localMachine` | `isDirector` | readout |
| Director mode | Whether the connected machine is in director mode. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.directorMode` | `directorMode` | readout |
| Understudy mode | Whether the connected machine is running as an Understudy. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.understudy` | `understudyMode` | readout |
| Solo mode | Whether the connected machine runs solo (no d3Net session) - REST 'isRunningSolo'. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.soloMode` | `soloMode` | readout |
| Has valid director | Session health: whether the d3Net currently has a valid Director. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.hasValidDirector` | `hasValidDirector` | readout |
| This machine taken over | Has the connected machine taken over a failed machine, without naming it. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.localMachine.hasTakenOverFailedMachine()` | `localTakenOver` | readout |
| This machine running as | Name of the machine the connected machine is currently running as ('running as <actor>' after a takeover). | `subsystem:D3NetManagerSystem` | `object.d3NetManager.localMachine.runningAs.name` | `localRunningAs` | readout |
| Machine count | Number of machines in the d3Net; a quick 'everyone is here' check against the expected count. | `subsystem:D3NetManagerSystem` | `len(object.d3NetManager.machines)` | `machineCount` | readout |
| Offline machines | Names of every machine in the d3Net that is not network-connected; [] means all online. | `subsystem:D3NetManagerSystem` | `[m.name for m in object.d3NetManager.machines if not m.networkConnected]` | `offlineMachines` | readout |
| Failed machines | Names of every machine currently flagged failed; [] means none. | `subsystem:D3NetManagerSystem` | `[m.name for m in object.d3NetManager.machines if m.failed]` | `failedMachines` | readout |
| Machines that took over | Names of the Understudies that have taken over a failed machine; [] means no failover is active. | `subsystem:D3NetManagerSystem` | `[m.name for m in object.d3NetManager.machines if m.hasTakenOverFailedMachine()]` | `takenOverMachines` | readout |
| d3Net machine table (JSON) | One-shot table of every machine with hostname, role, connected, active, failed and taken-over flags, for a status page or for other… | `subsystem:D3NetManagerSystem` | `[{"name": m.name, "hostname": m.hostname, "role": m.role, "connected": m.networkConnected, "active": m.active, "failed": m.failed, "takenOver": m.hasTakenOverFailedMachine()} for m in object.d3NetManager.machines]` | `machinesTable` | readout |
| Actor names | Names of the Actor machines in the session (REST /api/session/status/session 'actors'). | `subsystem:D3NetManagerSystem` | `[m.name for m in object.d3NetManager.actors]` | `actorNames` | readout |
| Understudy names | Names of the Understudy machines in the session (REST 'understudies'). | `subsystem:D3NetManagerSystem` | `[m.name for m in object.d3NetManager.understudies]` | `understudyNames` | readout |
| Understudy config table (JSON) | Pre-show check of every Understudy: its targets, configuration status (OK=0, TARGET_OVERLAP=1, NO_TARGETS=2, NO_VALID_TARGETS=3,… | `subsystem:D3NetManagerSystem` | `[{"understudy": u.name, "targets": [t.name for t in u.targets], "configStatus": object.d3NetManager.getUnderstudyConfigStatus(u), "takenOver": u.hasTakenOverFailedMachine(), "runningAs": (u.runningAs.name if u.hasTakenOverFailedMachine() else "")} for u in object.d3NetManager.understudies]` | `understudyTable` | readout |
| Auto failover timeout | Session-wide automatic failover timeout (REST failover/settings 'timeout'); 0 means automatic failover is disabled. | `subsystem:D3NetManagerSystem` | `object.d3NetManager.timeout` | `failoverTimeout` | readout |
| Taken over (by hostname) | Failover indicator for the machine whose hostname is in $(liveupdate:selHost) - for rigs where Companion config holds hostnames rather than… | `subsystem:D3NetManagerSystem` | `object.d3NetManager.findMachineByHostname("$(liveupdate:selHost)").hasTakenOverFailedMachine()` | `hostTakenOver` | readout |
| d3NetManager uid (discovery) | Discovery probe: the D3NetManager resource as {uid,path,type}; the uid gives a documented getByUID(<uid>) object path to the manager if… | `subsystem:D3NetManagerSystem` | `object.d3NetManager` | `d3NetManagerRef` | readout |
| Locked to director | D3State 'locked to director' flag (plausibly the GUI lock that keeps Actors following the Director); semantics undocumented. | `subsystem:MonitoringManager` | `state.lockedToDirector` | `lockedToDirector` | readout |
| Network adaptors (JSON) | Link state and speed of every NIC on the machine (r33.1+). | `Machine:"$(liveupdate:selMachine)"` | `[{"name": a.adaptorName, "ip": a.ipAddressStr, "up": a.isUp, "rx": a.receiveLinkSpeed, "tx": a.transmitLinkSpeed} for a in object.getNetworkAdaptors()]` | `machineNetworkAdaptors` | readout |

### 11 Templates

> Templates are generic buttons with literal placeholders; they do nothing until edited (the module skips subscribing while a path still contains '<' or '>'). After dragging one: (1) open the LiveUpdate Variable feedback and replace <OBJECT_PATH> with a Designer object expression (e.g. track:"Track 1", screen2:"LED Wall", transportManager:default, subsystem:MonitoringManager.findLocalMonitor("fps")) and object.<PROPERTY_PATH> with the Python member path (e.g. object.description, object.lengthInBeats, object.player.tRender); (2) each template carries its own variable name (tplString, tplSetNumber, ...); rename it to something meaningful for that object/property pair (letters, digits, underscore, max 40 characters) and change every $(liveupdate:...) in the button text and in the actions to the new name. One variable name must watch exactly one object/property pair: the module refuses a second subscription for a name that is already bound elsewhere and says so in the log, because the Set / Toggle actions find their subscription by variable name; two buttons watching the same path must use the same variable name; the interval of the feedback that subscribes first is the one that applies; (3) keep Update Frequency above 0 (prefilled from the State interval setting, 500 ms). Set / Nudge / Toggle actions do not take paths: they write to the subscription that owns the variable name, which is why each control template carries the matching feedback. Number values are JavaScript expressions evaluated after variable substitution ($(liveupdate:myValue)+1 works; the result must be a finite number); Boolean is a checkbox; JSON is a partial object merged into the property ({"x": 0.0} changes only x of a vector); String is sent verbatim. Object, array and resource values ({uid, path, type}) arrive as JSON strings, so use jsonparse / jsonpath in expressions (see Watch: JSON field x). A readout shows ERROR or PATH_ERROR when the Director rejects the path; fix the path, the module resubscribes on its own.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Watch: String | Generic readout of any string-valued property; plain text mode so the raw value (or ERROR / PATH_ERROR) is shown unchanged. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplString` | readout |
| Watch: Number (2 dp) | Generic readout of any numeric property formatted to two decimals. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplNumber` | readout |
| Watch: JSON field x | Generic readout of one field of an object/vector/resource value, which the module delivers as a JSON string. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplJson` | readout |
| Set Number 0 | Generic setter that writes a literal number (0) to the watched property and shows the current value. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplSetNumber` | set value |
| Set String | Generic setter that writes a literal string to the watched property and shows the current value. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplSetString` | set value |
| Set Boolean true | Generic enable button: writes true to the watched boolean property. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplBoolTrue` | set on/off |
| Set Boolean false | Generic disable button: writes false to the watched boolean property. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplBoolFalse` | set on/off |
| Toggle Boolean | Generic toggle for a boolean property using the Toggle Disguise Boolean action action; until that extension is approved the generator must… | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplToggle` | toggle |
| Set JSON {x: 0} | Generic partial-object write: sets only field x of a vector/object property (the Director merges partial JSON) and shows the current x. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplSetJson` | set JSON |
| Nudge +1 | Generic increment: adds 1 to the current numeric value on press; rotary right +1 / left -1 when rotary actions are enabled. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplNudgeUp` | nudge (Set to Disguise Number) |
| Nudge -1 | Generic decrement: subtracts 1 from the current numeric value on press; rotary left -1 / right +1 when rotary actions are enabled. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplNudgeDown` | nudge (Set to Disguise Number) |

### 99 Experimental

> Read-only presets that could not be confirmed on the r34.0.3 test rig: it had no Expression Variables device, DMX screen, timecode source, stage venue, Text layer or second transport, and one row (RS Layer Node Status) needs a running workload instance. They may show ERROR / PATH_ERROR; that is not a module bug. Confirmed rows are promoted to their home category without changing ids or variable names (103 rows were promoted after the 2026-09-04 live run).

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| [EXP] TC source name | Name of the assigned timecode transport (e.g. 'LTC 1') to show next to the lock indicator. | `transportManager:default` | `(object.timecode.description if object.timecode is not None else "")` | `tcSourceName` | readout |
| [EXP] Playhead (named transport) | Playhead of a transport manager that is not called 'default' (renamed or MultiTransport sub-transport). Needs selection variable(s)… | `transportManager:"$(liveupdate:selTransport)"` | `object.player.tRender` | `namedPlayheadBeats` | readout |
| [EXP] Text layer string (key 0) | Text-layer string at key 0 (read-only; the KeyString.s setter is inferred so no set preset). | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `object.findSequence("text").sequence.key(0).s` | `keyText` | readout |
| [EXP] DMX screen name | Name of the DMX screen; proves whether the dmxscreen: prefix resolves. | `dmxscreen:"$(liveupdate:selDmxScreen)"` | `object.description` | `dmxName` | readout |
| [EXP] DMX screen status | DMX output kill state: Mute (no DMX sent) or Active. | `dmxscreen:"$(liveupdate:selDmxScreen)"` | `object.status__` | `dmxStatus` | readout |
| [EXP] DMX screen universe | DMX universe of the first pixel (1-based). | `dmxscreen:"$(liveupdate:selDmxScreen)"` | `object.universe` | `dmxUniverse` | readout |
| [EXP] DMX screen fixture type | Name of the DmxFixtureType resource (channel layout). | `dmxscreen:"$(liveupdate:selDmxScreen)"` | `object.fixtureType.description` | `dmxFixtureType` | readout |
| [EXP] DMX screen table malformed | Health check for DMX table screens. | `dmxscreen:"$(liveupdate:selDmxScreen)"` | `object.isTableMalformed()` | `dmxTableMalformed` | readout |
| [EXP] Stage venue | Name of the active venue. | `getByUID($(liveupdate:selStageUid))` | `(object.venue.description if object.venue is not None else "")` | `stageVenue` | readout |
| [EXP] EV device description (smoke test) | Smoke test for the inferred expressionvariablesdevice: prefix - shows the device's user-visible name if the object path resolves. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.description` | `evDeviceDescription` | readout |
| [EXP] EV device started | Health indicator: variables become undefined when the device is not present/active in the Device Manager. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.started` | `evDeviceStarted` | readout |
| [EXP] EV variable count | Number of variables defined on the device - sanity check for index-based rows. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `len(object.container.variables)` | `evDeviceVarCount` | readout |
| [EXP] EV float by device+index | Value of the i-th Float variable via the device-name prefix (same member as ev_uid_float, different object path). | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].defaultFloat` | `evDevFloat` | readout |
| [EXP] EV string by device+index | Value of the i-th String variable via the device-name prefix. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].defaultString` | `evDevString` | readout |
| [EXP] EV name by device+index | Name of the i-th variable via the device-name prefix (dynamic button label). | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].name` | `evDevName` | readout |
| [EXP] EV type by device+index | Type enum of the i-th variable via the device-name prefix. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].type` | `evDevType` | readout |
| [EXP] EV error text by device+index | Health readout: error text of the i-th variable (duplicate definition or bad Function expression); empty is assumed OK. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].errorText` | `evDevError` | readout |
| [EXP] EV makeExpression() by index | Experiment: string returned by the variable's makeExpression() - presumably the 'name = value' / function text. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].makeExpression()` | `evDevExpression` | readout |
| [EXP] EV float by variable name | Float value looked up by variable name (robust to row reordering in the device editor). | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `[v.defaultFloat for v in object.container.variables if v.name == "$(liveupdate:selEvName)"][0]` | `evFloatByName` | readout |
| [EXP] EV value by variable name | Value looked up by name regardless of type (float for Float, string for String/Function). | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `[(v.defaultFloat if v.type == 0 else v.defaultString) for v in object.container.variables if v.name == "$(liveupdate:selEvName)"][0]` | `evValueByName` | readout |
| [EXP] EV all variables (dict) | One subscription that snapshots every variable as {name: value}; the button shows the entry named by selEvName, other buttons can reuse the… | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `{v.name: (v.defaultFloat if v.type == 0 else v.defaultString) for v in object.container.variables}` | `evDevAllDict` | readout |
| [EXP] EV all variables (detailed list) | Diagnostic: ordered list of every variable with type, float, string and error text; array index = the selEvIndex to use elsewhere. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `[{"name": v.name, "type": v.type, "float": v.defaultFloat, "string": v.defaultString, "error": v.errorText} for v in object.container.variables]` | `evDevAllList` | readout |
| [EXP] EV layer variables (module:) | Timeline (layer-based) expression variables of an ExpressionVariables layer under the playhead, with their current animated values. | `module:"$(liveupdate:selEvLayer)"` | `[{"name": f.variable.name, "type": f.variable.type, "value": f.value} for f in object.fields]` | `evLayerVars` | readout |
| [EXP] RS Layer Node Status | Designer's status string for the render machine assigned to instance selInstance. | `track:"$(liveupdate:selTrack)"` | `object.getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)].moduleConfig.cluster.instanceMachine($(liveupdate:selInstance)).statusString` | `rsLayerInstanceMachineStatus` | readout |
| [EXP] Director's understudy | Name of the first Understudy covering the acting Director (empty if none) - tells the operator whether the Director itself is protected. | `subsystem:D3NetManagerSystem` | `(object.d3NetManager.getDirectorUnderstudy().name if object.d3NetManager.getDirectorUnderstudy() is not None else "")` | `directorUnderstudy` | readout |
<!-- PRESETS:END -->

## Feedbacks

### LiveUpdate Variable

Creates the subscription and the module variable.

- **Variable Name**: name of the variable, letters, digits, `_` and `-` only
- **Object Path**: Designer expression, e.g. `track:"Track 1"`, `screen2:"Surface 1"`, `Machine:"Director"`, `getByUID(0x...)`, `subsystem:MonitoringManager.findLocalMonitor("fps")`. Companion variables are expanded before the subscription is made.
- **Property Path**: Python expression on `object`, e.g. `object.lengthInBeats`, `object.player.tRender`, `object.seriesAverage("Actual", 1)`
- **Update Frequency (ms)**: minimum time between updates (`0` = every change)

The feedback itself applies no style; use *LiveUpdate Compare* or Companion expressions for colours.

### LiveUpdate Compare

Boolean feedback on the current value of a LiveUpdate Variable: equals, not equal, less/greater
(numeric), true/non-zero/non-empty, contains text. Add it to any button, together with a LiveUpdate
Variable feedback of the same name somewhere in the config.

### Connection OK

True while the WebSocket to the Director is open.

## Actions

### Set to Disguise (String / Number / Boolean / JSON)

Write a value to the property behind a LiveUpdate Variable.

- **Variable Name**: the variable of the LiveUpdate Variable feedback whose subscription is written
- **Value**: string, number expression (`$(liveupdate:brightness)+0.05`), boolean checkbox or JSON
  text. JSON objects are merged: sending `{"x": 4.0}` to `object.offset` keeps `y` and `z`.

Use the type that matches the property; a string sent to a float property makes the Director close
the connection with "Cannot convert JSON String to double" (the module reconnects).

### Toggle Disguise Boolean

Flips a boolean property using the current value of its LiveUpdate Variable.

### Set selection

Sets one selection variable (dropdown) to a value (variables allowed, e.g. `$(custom:show_track)`)
and stores it in the connection settings. Put it on a button to switch every track preset to another
track in one press.

## Variables

- `connection_status`: `Connected` / `Disconnected`
- `sel...`: the selections (see *Selections*)
- one variable per active LiveUpdate Variable feedback, named as configured

## Using with the OSC module

Put the OSC module's *Show control* presets (play, stop, next section, fades) and this module's
readouts on the same page. The transport presets use the OSC module's variable ids where the value
matches, so button expressions can be swapped between the two:

| OSC module variable | LiveUpdate preset / variable | Notes |
|---|---|---|
| `trackname` | `Current track name` / `trackname` | |
| `playMode` | `Play mode (string)` / `playMode` | Python string of the play mode |
| `brightness`, `volume` | `Master brightness` / `Master volume` | writable here (nudges, full, zero) |
| `bpm` | `[EXP] BPM at playhead` / `bpm` | experimental |
| `currentSectionName`, `nextSectionName` | experimental transport presets | experimental |
| `sectionElapsed`, `sectionRemaining` | experimental transport presets | **beats**, not seconds |
| `trackposition`, `timecodeposition` | experimental transport presets | experimental; `Playhead (beats)` is documented |
| `heartbeat` | `Connection status` / `connection_status` | |

## Object path reference

- `type:name` finds a resource by type and name: `track:"Track 1"`, `screen2:"Surface 1"`,
  `projector:"Projector 1"`, `Machine:"Director"`, `transportManager:default`. Names with spaces need
  the quotes; older Designer versions only accept the sanitised form (`track:track_1`).
- `getByUID(0x...)` finds any resource by UID, independent of its name (right-click the editor
  title bar > Copy UID).
- `subsystem:MonitoringManager` and `subsystem:RenderStreamSystem` address the subsystems shown in
  the LiveUpdate documentation; other `subsystem:` prefixes are experimental.
- Chained calls are allowed in the object part: `track:"Track 1".findLayerByName("Video 1")`,
  `subsystem:MonitoringManager.findLocalMonitor("fps")`.
- Remote monitors take the node name `"<hostname>:d3"`.
- Documented monitor names: `fps` (series `Actual`), `GPUProfiler` and `CPU` (series `Total`),
  `GPUMemory` (`Usage(MB)`), `ProcessMemory` (`Usage (MB)`).

## Troubleshooting

- Variable shows `$NA`: the selection the preset depends on is empty, or the variable name in the
  button text does not match the feedback.
- Variable shows `ERROR`: the Director could not resolve the object path (wrong name, wrong type
  prefix, object does not exist). The subscription is retried with a growing back-off (2 s up to
  60 s) until you fix the path.
- Variable shows `PATH_ERROR` / `PATH_ERROR (unsubscribed)`: the object exists but the property
  expression fails; after three errors the module unsubscribes and retries with the same back-off
  (2 s doubling up to 60 s, reset by the first good value or by editing the feedback).
- Log says "Selection rejected" or "Selection ignored": the value contains characters that are not
  allowed for that selection (see *Selections*); the selection stays unset.
- A control does nothing: the button needs the LiveUpdate Variable feedback with the same variable
  name; check the log for "No LiveUpdate Variable found".
- Connection closes right after a set: wrong value type for the property, see *Set to Disguise*.
- Values are in **beats** unless stated otherwise (track time); `beatToTime` converts to seconds.

## Limits

- No transport commands (protocol limit), no failover or RenderStream commands (REST only).
- Whether a property accepts a set can only be found out by trying; the presets only ship writes on
  members that have a setter in the Designer API.
- Object paths in `99 Experimental` are not documented by disguise and may fail on your version.

## Links

- [LiveUpdate API](https://developer.disguise.one/api/session/liveupdate)
- [Monitoring machine health](https://developer.disguise.one/api/guides/monitoring)
- [Designer expressions: accessing resources](https://help.disguise.one/designer/configuration/expressions/accessing-resources)
- [Python API type stubs](https://developer.disguise.one/assets/d3.pyi)
- Module source, catalog and verification notes: `docs/` in the repository
