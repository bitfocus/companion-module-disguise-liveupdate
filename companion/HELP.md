# disguise: LiveUpdate

Monitor and control disguise Designer from Companion. Through the WebSocket **LiveUpdate API** the
module subscribes to any property of the show (frame rate, transport state, track and layer data,
screen geometry, RenderStream health, failover state) as a live Companion variable, and writes
properties back. Through Designer's **Session REST API** it sends the commands LiveUpdate cannot
carry: play, stop, section and track jumps, brightness and volume, RenderStream layer control and
failover (see *Commands*).

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

## Commands

LiveUpdate reads and writes properties; it cannot tell the Director to play, stop or jump. The module
sends those commands over Designer's Session REST API, on the same host and port as the LiveUpdate
connection, so no second module is needed for them:

- **Transport:** *Play*, *Stop*, *Play to end of section*, *Loop section*, *Return to start*, *Next
  section*, *Previous section*, *Next track*, *Previous track*, *Go to section*, *Go to note*, *Go to
  tag*, *Go to track*, *Go to timecode*, *Go to time (seconds)*, *Set brightness*, *Set volume*, *Set
  speed*, *Set engaged*.
- **RenderStream:** *Start layers*, *Stop layers*, *Restart layers*, *Sync layers*.
- **Failover:** *Fail over machine*, *Restore machine*, *Apply default routing*.
- **Command: rescan the command API** (see below).

### What fires on one press

While *Enable commands* is on (the default), every **Transport:** action fires on a single press.
None of them counts as destructive: *Stop*, *Set brightness* 0 and *Set volume* 0 go out at once, so
place those buttons where they cannot be hit by accident.

Only the **RenderStream:** and **Failover:** actions, which change the shape of the session, are
gated. They are refused until *Allow destructive commands* is on (it is off by default). Then the first
press only arms the command, and a second press of the same button within *Confirm within (s)*
(default 5) sends it. The arm is tied to the button and to the resolved target, so changing the machine
between the presses arms again instead of firing at the new one. Arms are dropped when *Allow
destructive commands* or *Enable commands* is turned off, or when the host or port changes.

Put the *Command armed* feedback on the button: it lights only on the button whose press armed the
command. `rest_armed` names the most recent arm that is still waiting (empty when none is).

### What happened

After a command is sent, `rest_last_command`, `rest_last_status` (`OK`, `FAILED` or `UNSUPPORTED`)
and `rest_last_message` report what happened, and *Last command failed* colours a button while the
last command this connection sent did not succeed. That feedback covers the whole connection, not one
button.

A press that is refused before anything is sent only writes a warning to the log: commands switched
off, destructive commands not allowed, or a parameter that cannot be sent (see below). The
`rest_last_*` variables and *Last command failed* keep describing the previous command, and nothing
is armed.

A command the Director knows but will not carry out answers HTTP 200 with a reason in the body; the
module counts that as `FAILED` and puts the Director's own words in `rest_last_message`. A reply that
does not arrive within *Command timeout (ms)* (default 5000), or that stalls or breaks after its
headers, is a failure too (`timed out`, `timed out reading the reply` or
`could not read the reply: ...`).

A Designer that does not know a command answers 404 or 405. The module sends such a command once,
remembers the answer and does not send it again: later presses report `UNSUPPORTED` and log "This
Designer build has no '...' command" each time. *Command: rescan the command API* forgets what was
remembered, for example after a Designer upgrade; saving the connection settings does too.

### Command parameters

- **Transport, track, machine and RenderStream layers** take a name or a uid. A value of 6 or more
  digits only is sent as a uid, anything else as a name. Prefix `name:` to force a name
  (`name:20250914` for a date-stamped track) or `uid:` to force a uid (decimal digits only). A bare
  prefix, or `uid:` followed by anything but digits (a `0x` hex id, for example), is refused. The
  prefixes are lowercase.
- Every free-text parameter (transport, track, machine, the layer list and each entry in it, section,
  note, tag value, timecode, and the number fields time, brightness, volume and speed) is checked
  after its variables are parsed. When it is empty, contains `$NA` (an unknown variable or an empty
  selection) or still holds a `$(...)` reference, the command is refused with one warning and nothing
  is sent. An empty number field is never sent as 0.
- A RenderStream layer list is comma separated and every entry must resolve. An empty entry (a
  trailing or double comma included) or an unresolved one refuses the whole command: no partial list
  is sent, and a destructive command is not armed.
- *Go to section*, *Go to note*, *Go to tag*, *Go to track*, *Go to timecode* and the four *Next /
  Previous section / track* actions have *Play mode after the jump*: `Leave unchanged` (the default,
  sent as `NotSet`), `Play`, `PlaySection`, `Loop` or `Stop`. A next / previous button saved before the
  option existed sends `Leave unchanged`, so the play state stays as it was.

### Established on an r34.0.3 Director

`scripts/rest-command-verify.mjs` sent the commands to a Designer r34.0.3 Director on 2026-09-04
(`docs/research/rest-verification.json`). *Play*, *Stop*, *Play to end of section*, *Loop section*,
*Return to start*, *Next section*, *Previous section*, *Go to section*, *Go to note*,
*Go to timecode*, *Go to time*, *Set brightness*, *Set volume* and *Set engaged* were sent, checked
and put back: each step read the state before and after the command and restored it. *Next track*,
*Previous track* and *Go to track* were accepted but could not change the track, because the test
project's set list had one track. *Sync layers* was accepted. *Set speed* was refused (see below) and
*Go to tag* was not sent. Starting, stopping and restarting layers and the failover commands were not
sent, because a second command does not undo them. The script sent its jumps with play mode `Stop`.
The next / previous section and track actions now send the body the OpenAPI document records for
them, with the play mode chosen on the button; that body has not been sent to a Director by the
module yet.

- *Go to section* takes the section **number**, counting from 0. The published API describes the
  field as a string, but Designer parses it as an integer and refuses a section name. To jump by the
  name written on the section, use *Go to note*.
- *Go to timecode* accepts both `hh:mm:ss:ff` and the dotted `hh:mm:ss.ff` that the timecode
  variables of this module report, so a variable can be dropped straight into the field.
- *Set speed* is refused unless **enableTransportSpeedControl** is enabled in Designer. The button
  will show *Last command failed* and `rest_last_message` will say so.

## Choosing selections from the Director

Instead of typing a track or surface name, use the per-selection actions (*Set selection: Track*,
*Set selection: Surface (screen2)*, ...). Their value is a dropdown of the names Designer actually
has, read when the connection comes up (*Read selection lists on connect*, on by default) and whenever
the *Refresh selection lists* action runs. A name can still be typed.

Any answer from the Director replaces a list, even an empty one; the action then falls back to a text
field. A read that fails (an error or no answer) keeps the previous list, and a list that needs a
selection that is empty (the layer list needs `selTrack`) is left as it is. A list whose property a
placed button already holds is read from that button.

*Set selection profile* applies several selections (track, layer, surface, projector, machine,
RenderStream workload) with one press, so one button re-points a whole page at another part of the
show. A field left empty leaves that selection unchanged.

## Seeing a trend

The *LiveUpdate Sparkline* feedback draws the recent values of a variable as a line on the button.
Put it on the same button as the LiveUpdate Variable feedback that owns the value; the number stays
readable on top. Options: *Samples to keep* (default 60), *Scale to the values seen* or a fixed
*Minimum* / *Maximum*, *Line colour*, *Fill under the line* (on by default) and an optional threshold
rule such as a frame budget.

- *Samples to keep* counts value updates, not time: 60 samples of a 1000 ms monitor are one minute.
  It is held to 4..300, and a blank or unreadable value means 60. Each Sparkline draws its own number
  of samples; two Sparklines on the same variable share one history, kept for the longer window.
- A value the readout loses shows as a break in the line and in the fill, never as a line joining the
  values on either side: `OFFLINE` during an outage, `PENDING` while a request waits for its answer,
  `ERROR`, `PATH_ERROR`, `PATH_ERROR (unsubscribed)`, `UNSET` and any other value that is not a number
  (empty text, objects, arrays). An outage or an error streak of any length is one break, and the
  column the break falls in stays empty.
  During an outage the button is redrawn with the break, so the line stops short of the right edge.
- Numeric text is drawn as its number, and on/off values as 1 and 0. The fill covers every column
  under the line, also while the history is still short. With more samples than pixel columns, a
  column shows the range of the samples in it. The threshold rule is drawn over the fill, and the line
  over the rule.

**Companion 5** (checked on 5.0.4) draws the line into an *Image* layer of the button. Buttons placed
from this module's presets already have one below the text, so a Sparkline added to them works
without extra steps. A button created by hand starts with only the Canvas, Background and Text layers:
a Sparkline added to it shows nothing, and nothing is logged. Add the layer first:

1. Open the button and select the **Background** layer in the layer list.
2. Click *Add element* (**+**) and choose **Image**. The new layer is inserted directly above the
   selected one, so it sits below Text and the number stays on top.
3. Add the *LiveUpdate Variable* and *LiveUpdate Sparkline* feedbacks.

Companion binds the image when the feedback is added, so a Sparkline added before the button had an
Image layer does not use a layer added later. Delete that Sparkline and add it again, or open the
feedback's style overrides, use *Add override* on the Image layer's *Image* property and pick *Image
Buffers (Deprecated)*, which is Companion's name for this output.

## Checking the presets on your Director

*Check presets against this Director* subscribes once to every preset property whose selections are
filled in, records whether the Director answered with a value and releases it again. Rows that share
a property are checked once, so every count is of distinct properties:

- `selfcheck_ok`: answered with a value;
- `selfcheck_failed`: answered with an error, or not at all;
- `selfcheck_skipped`: need a selection that is empty or invalid;
- `selfcheck_progress`: `checked/total` while the check runs.

Template rows and rows without a path (the connection indicator) are not counted. A property a placed
button already holds is read from that button, without a subscription of its own, so the check does
not touch the subscriptions your buttons hold. Run it when you arrive on site: it tells you which
presets work with this Designer build and this show file.

## Designer version

`$(liveupdate:designer_version)` holds the version of the connected Director
(`ReleaseVersion.versionString()`, for example `r34.0.3, rev 258249`). It is read on every connection,
whatever *Read selection lists on connect* says. The log warns when the major version differs from
r34, the version the preset catalog was verified against (`r34.0.3`, `34.0.3.258249` and `d3 r34.0.3`
are all understood).

## What a readout shows

A LiveUpdate Variable holds the Director's value: numbers, text and booleans as they are, objects and
arrays as JSON text. In place of a value it can hold one of these words, and the preset buttons show
them as they are, unformatted and without a unit, so you can read the state off the button itself. The
last two rows are not words the module writes:

| On the button | Meaning |
|---|---|
| `PENDING` | requested from the Director, no value yet: the connection has just opened, the feedback was just placed or changed, or a request that failed or went unanswered is being made again |
| `OFFLINE` | the connection to the Director is closed, or not open yet |
| `ERROR` | the Director refused the object path: wrong name or type prefix, or the object does not exist |
| `PATH_ERROR` | the object exists but the property path failed |
| `PATH_ERROR (unsubscribed)` | the property path failed three times in a row; the subscription was dropped and is retried with a back-off |
| `UNSET` | the path cannot be resolved yet: an empty selection or `$NA`, an unparsed `$(...)`, an empty object or property path, a bare empty name such as `track:""`, or a template placeholder such as `<OBJECT_PATH>` |
| (empty) | the Director's value is empty: an empty text, or `None`. A feedback that shares its property with another feedback under a different Variable Name is empty as well: only the first name receives the values, and the log says "Feedbacks share ... with different variable names" |
| `$NA` | Companion's own text for a variable that is not defined: the name in the button text matches no LiveUpdate Variable feedback of this connection, or the connection has not started |

Formatted preset texts (numbers, times, on/off words, JSON fields) format only a value of the kind they
expect and show anything else as it is: an on/off readout shows its words (YES / no, HELD / Live,
RUNNING / STOPPED, ...) only for a real true or false, a numeric readout decodes only numbers, and a
JSON readout shows the raw value when it is not JSON. A button therefore never shows NaN or a
healthy-looking word for a value it does not have, and an empty value stays empty (never 0, OK or an
on/off word). When you edit a preset's text, keep its `isNumber(...)` / `jsonparse(...) === null`
guard, and keep a comparison such as `== 0` inside it: in a Companion expression `'' == 0` is true.

Clearing a selection, or emptying a path, makes the readout show `UNSET` instead of the previous
object's value, unless another feedback still feeds the same variable name; a *LiveUpdate Compare* on
it turns off.

The module does not send a path that is empty, holds a template placeholder such as `<OBJECT_PATH>`,
`$NA` or a raw `$(...)` reference, and for object paths also a bare empty name (`type:""` or `type:''`)
or the remote-monitor node without a host (`":d3"`). Everything else is sent as written, including
`""`, `[]` and `(1,)` in a property path and `findLayerByName("")`; when the Director cannot evaluate
it, the readout shows `ERROR` or `PATH_ERROR`. A refused path is logged once per feedback, at warn
level, and the readout shows `UNSET`.

## When the Director goes away

Every readout owned by a LiveUpdate Variable feedback is set to `OFFLINE` rather than keeping the last
value it had, because a stale number on a monitoring button is worse than no number. Selections and
the module's own variables keep their values, and `connection_status` goes to `Disconnected`. The
variables stay defined, also when you save the connection settings while the Director is away, and
the module reconnects on its own after the *Reconnect Interval*. A feedback placed or renamed while
the Director is away shows `OFFLINE` as well.

On disconnect and on reconnect the module re-checks *Connection OK*, *LiveUpdate Compare*,
*LiveUpdate Sparkline*, *Command armed* and *Last command failed*, so no state colour outlives the
connection. After a reconnect no readout stays `OFFLINE`: each one says `PENDING` until its value
arrives, or shows `UNSET` when its path cannot be resolved. Changing the host or port while connected
shows `OFFLINE` in every readout until the connection to the new Director opens.

## Configuration

### Connection settings

- **Director IP Address**: the Designer Director machine (default: 127.0.0.1)
- **Port**: HTTP/WebSocket port of the Director (default: 80); the commands use the same host and port
- **Reconnect Interval (ms)**: wait before reconnecting after a connection loss (default: 5000)
- **Pending Subscription Timeout (ms)**: how long a subscribe request may stay unanswered (default: 30000)

### Preset settings

- **Show experimental presets**: adds the `99 Experimental` category (read-only presets whose object
  path is not documented for LiveUpdate, see *Experimental presets*). Off by default.
- **Monitoring / Playhead / State / Static interval (ms)**: the update intervals written into the
  presets when you place them (defaults 1000 / 250 / 500 / 5000). A placed button keeps its own
  value and can be edited per feedback; editing it re-subscribes. `0` means "as fast as possible" (the
  Director's default) and is not recommended for monitors.
- **Read selection lists on connect** (default on): read the names the *Set selection: ...* actions
  offer when the connection comes up (see *Choosing selections from the Director*). The Designer
  version is read either way.

Buttons that share one property share one Director subscription, which runs at the fastest interval
any placed feedback asks for; `0` beats any number. When a faster feedback joins, the module subscribes
again at the faster rate, also when the first request is still on its way. Removing the faster button
does not slow the subscription down again straight away. The intervals are remembered across
reconnects.

### Commands

- **Enable commands** (default on): send the *Transport:*, *RenderStream:* and *Failover:* actions.
  Off, every command press is refused and logged.
- **Allow destructive commands** (default off): allow the *RenderStream:* and *Failover:* actions,
  which then need two presses (see *Commands*).
- **Confirm within (s)** (default 5, shown when destructive commands are allowed): how long an armed
  command waits for its second press.
- **Command timeout (ms)** (default 5000): how long a command may take, reading the reply included.

### Selections

The presets do not contain fixed object names. They address the show through **selection
variables** such as `$(liveupdate:selTrack)` inside their object paths, for example
`track:"$(liveupdate:selTrack)"`. Fill the selections in here once, or change them live with the
*Set selection* actions; every preset built on a selection re-subscribes to the new object
automatically.

The presets follow their own connection. They are written with the connection's label, so a second
connection (`liveupdate_2`) or a renamed one gets `$(liveupdate_2:selTrack)` in its paths and follows
its own selections. Companion 5.0.4 rewrites the label in a preset's button text, style overrides and
action options itself, but not in its feedback options, so the module writes it there. Buttons placed
before a rename are relabelled by Companion.

| Selection | Variable | What to enter |
|---|---|---|
| Track | `selTrack` | track name as shown in Designer, e.g. `Track 1` |
| Layer | `selLayer` | layer name inside the selected track, e.g. `Video 1` |
| Layer index | `selLayerIndex` | 0-based position in the track's layer list (`track.layers`), for the "(by index)" presets |
| Section index | `selSection` | 0-based section index |
| Beat | `selBeat` | a track beat, e.g. `32` |
| Surface (screen2) | `selScreen` | surface name, e.g. `Surface 1` |
| Projector | `selProjector` | projector name |
| Display UID | `selScreenUid` | UID of any display, hex with `0x` (right-click the editor title bar > Copy UID) |
| Machine | `selMachine` | Machine resource name as listed in d3Net Manager |
| Remote host | `selHost` | hostname of the remote machine **without** `:d3` (the presets append it) |
| RenderStream workload id | `selWorkload` | integer id (the *RS Layer Workload ID* preset shows it; also REST `GET /api/session/renderstream/layerstatus` or the Cluster Workload widget > Copy UID) |
| RenderStream instance index | `selInstance` | 0-based |
| Expression Variables device UID | `selEvUid` | hex with `0x` |
| Expression variable index | `selEvIndex` | 0-based row inside the device |
| LED screen | `selLedScreen` | LED screen name, e.g. `LED 1` |
| Stage UID | `selStageUid` | UID of the Stage, hex with `0x` |
| RenderStream layer index | `selRsLayer` | 0-based index among the selected track's RenderStream leaf layers (the RS Layer presets also need `selTrack`) |

Experimental presets use five more selections (`selTransport`, `selDmxScreen`, `selEvDevice`,
`selEvName`, `selEvLayer`); they only appear in the settings when experimental presets are enabled.

Names are used verbatim (case-sensitive) inside quotes and must not contain quotes, backslashes or
line breaks; hostnames allow letters, digits, `.`, `_` and `-`; indices are plain decimal integers
(no leading zero); UIDs and workload ids are decimal or `0x` hex integers. A *Set selection* action
with an invalid value is refused and the selection keeps its previous value; an invalid value in the
connection settings is ignored and the selection counts as empty. Both write a log message. An empty
selection is published as `$NA`; the presets that depend on it do not subscribe, and their readouts
show `UNSET` until it is filled in.

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
- One variable name watches one object/property pair: a second feedback that uses the name for
  another pair is not subscribed, and the log says so, because the Set and Toggle actions find their
  subscription by variable name.
- Objects and arrays arrive as JSON text; use `jsonparse(...)` in an expression to read a field.
  Designer resources arrive as `{"uid": ..., "path": ..., "type": ...}`.
- Property paths run as Python 2.7 expressions on the Director; method calls, list and dictionary
  comprehensions are allowed. Never call a method that changes state inside a property path.
- "Set to Disguise" actions write to the subscription created by the feedback with the same variable
  name, so a control button always carries that feedback as well. Writes are undoable in Designer
  and are saved with the project.
- Subscribe requests asked for together (a reconnect, a page of presets placed at once, a selection
  change) leave as one frame per object and update interval; the Director still holds one
  subscription per property.

## Presets

Categories are numbered because Companion sorts them alphabetically. Each category starts with a
*Setup* text preset that lists the selections it needs. Readouts use a dark style; write buttons are
amber, enable/on buttons green and disable/hold/off buttons red. Presets marked with a state colour
carry a *LiveUpdate Compare* feedback (for example FPS turns red below 50, "taken over" turns red).

### Experimental presets

Designer's Python API exposes far more than the LiveUpdate documentation shows. Presets whose object
path is only inferred from the API stub (for example `expressionvariablesdevice:"..."`,
`dmxscreen:"..."`, a named `transportManager:"..."`) are shipped read-only in `99 Experimental`, named
`[EXP] ...`, and only when *Show experimental presets* is enabled. They may show `ERROR` or
`PATH_ERROR`; that is not a module bug. Presets that prove to work on a Director are promoted to
their home category in a later release without changing their ids or variable names.

### Preset list

<!-- PRESETS:START -->

_310 presets ship by default; 25 experimental presets appear when "Show experimental presets" is enabled. Object paths use the selection variables described above._

### 01 Connection

> LiveUpdate can READ and SET Designer properties but cannot carry commands, so this module sends them over the Designer Session REST API on the same host and port: play, stop, section and track jumps, go to time / timecode / note / tag, brightness, volume, speed and engage are the 'Transport:' actions; starting, stopping, restarting and syncing RenderStream layers are the 'RenderStream:' actions; failing over and restoring a machine and the default routing are the 'Failover:' actions. RenderStream and Failover commands are destructive: they are refused until 'Allow destructive commands' is on in the connection settings, and then need two presses of the same button. Presets address show objects through the module's own selection variables ($(liveupdate:selTrack), $(liveupdate:selScreen),...). Set them once in the connection settings (section "Selections") or from a button with the "Set selection" action; every preset that uses a selection re-subscribes automatically when it changes. Normal-tier selections: selBeat = a track beat as a number, e.g. 32; selEvIndex = 0-based row index of the variable inside the device (unquoted integer); selEvUid = UID of the Expression Variables device, hex with 0x prefix; selHost = hostname of the remote machine WITHOUT the :d3 suffix (the presets append it); selInstance = 0-based RenderStream instance index (unquoted integer); selLayer = layer name inside the selected track (selTrack), e.g. Video 1; selLayerIndex = 0-based position in the track layer list (unquoted integer) for the "(by index)" presets; selLedScreen = LED screen name; selMachine = Machine resource name exactly as listed in d3Net Manager (the same string is used for remote node lookups and RenderStream machine names; confirm on your Director); selProjector = projector name; selRsLayer = 0-based index among the track's RenderStream leaf layers; selScreen = Surface (screen2) name; selScreenUid = UID of any display, hex with 0x prefix (right-click the editor title bar > Copy UID); selSection = 0-based section index (unquoted integer); selStageUid = Stage UID, hex with 0x prefix; selTrack = track name as shown in Designer, e.g. Track 1 (quoted by the paths); selWorkload = RenderStream workload id as unquoted decimal digits (the RS Layer Workload ID preset shows it as text; also Cluster Workload widget > Copy UID or REST GET /api/session/renderstream/layerstatus). Experimental presets (category 99, names prefixed [EXP]) are hidden until the connection setting "Show experimental presets" is on; they use: selDmxScreen = DMX screen name; selEvDevice = Expression Variables device name (file name part of objects/ExpressionVariablesDevice/&lt;name&gt;.apx); selEvLayer = Expression Variables layer name (module: prefix); selEvName = expression variable name, case-sensitive; selTransport = transport manager name other than default. Update intervals are prefilled from the connection settings (Monitoring / Playhead / State / Static) and can be edited per button.

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

> Object path for every preset in this category: transportManager:default (Designer's default transport manager; no selection needed). Readouts: playhead in beats (equals seconds at 60 bpm), play mode as string and as state enum, playing / stopped / holding flags, play-to-end and loop-section modes, track loaded, playback speed, current track name and length, section count, timecode chase and source status strings, incoming timecode and pre-roll countdown. Controls: master brightness and volume (readout, +/-5 % nudges with rotary support, FULL / ZERO / MUTE), ENGAGE / DISENGAGE and a one-button Engaged toggle (Toggle Disguise Boolean action). Values with state colours use the LiveUpdate Compare feedback. Transport commands (play, stop, section and track jumps, go to time / timecode / note / tag) cannot travel over LiveUpdate; this module sends them over the Session REST API as its 'Transport:' actions.  Also included after the live run: track position and timecode position strings, free-running flag, BPM at playhead, section index, current / next section names, section elapsed and remaining (beats), set-list track names, active layer count and the GUI playhead. Still experimental (99): the timecode source name and the playhead of a named transport (the test project has one transport and no timecode source).

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
| Engaged toggle | Toggle engaged on/off with one button (Toggle Disguise Boolean action); the separate engage / disengage presets stay available. | `transportManager:default` | `object.engaged` | `engaged` | toggle |
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
| Screen hold toggle | Toggle the per-display Hold with one button (needs the Toggle Disguise Boolean action). | `screen2:"$(liveupdate:selScreen)"` | `object.holdOutput` | `screenHoldOutput` | toggle |
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
| Projector hold toggle | Toggle the per-display Hold with one button (needs the Toggle Disguise Boolean action). | `projector:"$(liveupdate:selProjector)"` | `object.holdOutput` | `projectorHoldOutput` | toggle |
| Display (UID) name | Name of the display addressed by UID; confirms that $(liveupdate:selScreenUid) points at the right object. | `getByUID($(liveupdate:selScreenUid))` | `object.description` | `uidName` | readout |
| Display (UID) master fade | Output brightness of the display addressed by UID (0..1, applied at Feed level, not shown in the visualiser). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | readout |
| Display (UID) fade +0.05 | Raise master fade by 0.05 (rotary: right = up, left = down). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | nudge (Set to Disguise Number) |
| Display (UID) fade -0.05 | Lower master fade by 0.05 (rotary: right = up, left = down). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | nudge (Set to Disguise Number) |
| Display (UID) fade 1.0 | Set master fade to full brightness. | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | set value |
| Display (UID) fade 0.0 | Black out this display at the Feed output (content keeps running). | `getByUID($(liveupdate:selScreenUid))` | `object.master_fade` | `uidMasterFade` | set value |
| Display (UID) hold output | Whether the display addressed by UID is frozen (per-display Hold). | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | readout |
| Display (UID) hold ON | Freeze this display output while sequencing continues. | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | set on/off |
| Display (UID) hold OFF | Release the per-display Hold. | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | set on/off |
| Display (UID) hold toggle | Toggle the per-display Hold with one button (needs the Toggle Disguise Boolean action). | `getByUID($(liveupdate:selScreenUid))` | `object.holdOutput` | `uidHoldOutput` | toggle |
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

> Expression Variables device readouts. Fill these selections in first (connection settings > Selections, or the "Set selection" action): selEvUid = the device UID as an unquoted hex literal (Designer: right-click the Expression Variables device editor title bar > Copy UID, e.g. 0x0123456789abcdef); selEvIndex = zero-based row index of the variable in the device editor (plain integer, no quotes; rows can be drag-reordered so re-check after edits). Presets in this category read the i-th variable through getByUID(selEvUid).container.variables[selEvIndex]: defaultFloat (value of a Float variable), defaultString (value of a String variable), name and type (0 Float, 1 String, 2 Function). The readouts are read-only. Two knobs (EV float +/-0.1) write defaultFloat through the list subscript; that write is the one part of this category that could not be tested on the verification rig, because the test project had no Expression Variables device. Try them on a spare variable before using them in a show. Experimental rows (see 99 Experimental) additionally need selEvDevice (device name = filename part of objects/ExpressionVariablesDevice/&lt;name&gt;.apx), selEvName (variable name, case-sensitive) and selEvLayer (name of an ExpressionVariables layer currently under the playhead). None of the Expression Variables rows could be checked live: the test project has no Expression Variables device.

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

> RenderStream presets read subsystem:RenderStreamSystem (cluster/instance health, per-node flags, receive statuses, active latency) and Machine takeover. Fill these selections in first (connection settings > Selections, or the "Set selection" action): selWorkload = workload ID as a Python int - copy it from the Cluster Workload widget ('Copy UID') or from REST GET /api/session/renderstream/layers then GET /api/session/renderstream/layerstatus?uid=&lt;layer uid&gt; (workload.uid); if the copied value is hex, enter it as 0x...; selInstance = zero-based instance index inside the workload (0 = first render node); selMachine = render node / machine name exactly as shown in the Cluster Workload widget Instances > Machine column. The 'RS workload layer count' preset shows how many layers carry a workload (on r34.0.3 the id map itself serialises empty, so read ids through the RS Layer Workload ID preset). The layer-route presets (RS Layer ...) need selTrack (track name) and selRsLayer (zero-based index of the RenderStream layer among the track's RenderStream leaf layers); the RS Layer Workload ID preset shows the workload id as text ready for selWorkload. The aggregate rows (node summary, running count, any dropping / down, health list, min FPS, max latency, dropped total, all subscribed, last errors, status messages) were verified live with a workload that had no running instances. All RenderStream rows are read-only: LiveUpdate cannot start or stop a workload. The module's 'RenderStream:' actions (start, stop, restart and sync layers) send those commands over the Session REST API; they are destructive, so they need 'Allow destructive commands' in the connection settings and two presses. While a workload has no running instances the per-instance rows show PATH_ERROR (the Director answers "out of range error accessing workload instance"); the module backs off and retries on its own.

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

> These presets read the failover / d3Net state of ONE machine addressed by name. Fill in the selection selMachine and set it to the machine's resource name exactly as it appears in Designer's d3Net Manager / Machines list (the 'name' field of GET /api/session/status/health - not necessarily the Windows hostname). Every preset here uses the object path Machine:"$(liveupdate:selMachine)"; change the selection variable(s) and all presets re-point at once (duplicate the page and use a second selection variable(s) if you need two machines side by side). Readouts: taken over a failed machine (understudy side), failed (actor side), auto failover disabled, network connected, network status code, active, role, running as, understudy targets, plus identity: machine name, hostname, IP, hardware type, d3Net node id, GUI visible, resource status. There are deliberately NO write presets in this category: role, hostname, director and understudy targets reconfigure the session, and the fail over / restore machine commands are not reachable through a LiveUpdate set: they are the module's 'Failover:' actions over the Session REST API (destructive, so they need 'Allow destructive commands' in the connection settings and two presses). Alarm colours: add the liveUpdateCompare feedback as noted per preset (red = failed / offline / taken over / inactive, amber = auto failover disabled). Rows for the connected machine itself, the acting director, offline / failed / taken-over lists across the whole d3Net, understudy configuration, the failover timeout, network adaptors and by-hostname addressing (selection selHost, shared with 03 Monitoring Remote) were verified live and are included. Only the name of the Director's understudy stays experimental (no understudy in the test project). Values update at the state (500 ms) or static (5000 ms) rate; failover indicators are method calls that the Director may evaluate on every cycle, so do not lower them below the defaults.

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
| This machine running as | Name of the machine the connected machine is currently running as ('running as &lt;actor&gt;' after a takeover). | `subsystem:D3NetManagerSystem` | `object.d3NetManager.localMachine.runningAs.name` | `localRunningAs` | readout |
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
| d3NetManager uid (discovery) | Discovery probe: the D3NetManager resource as {uid,path,type}; the uid gives a documented getByUID(&lt;uid&gt;) object path to the manager if… | `subsystem:D3NetManagerSystem` | `object.d3NetManager` | `d3NetManagerRef` | readout |
| Locked to director | D3State 'locked to director' flag (plausibly the GUI lock that keeps Actors following the Director); semantics undocumented. | `subsystem:MonitoringManager` | `state.lockedToDirector` | `lockedToDirector` | readout |
| Network adaptors (JSON) | Link state and speed of every NIC on the machine (r33.1+). | `Machine:"$(liveupdate:selMachine)"` | `[{"name": a.adaptorName, "ip": a.ipAddressStr, "up": a.isUp, "rx": a.receiveLinkSpeed, "tx": a.transmitLinkSpeed} for a in object.getNetworkAdaptors()]` | `machineNetworkAdaptors` | readout |

### 11 Templates

> Templates are generic buttons with literal placeholders; they do nothing until edited (the module does not subscribe while a path still contains a placeholder such as &lt;OBJECT_PATH&gt;; the readout shows UNSET). After dragging one: (1) open the LiveUpdate Variable feedback and replace &lt;OBJECT_PATH&gt; with a Designer object expression (e.g. track:"Track 1", screen2:"LED Wall", transportManager:default, subsystem:MonitoringManager.findLocalMonitor("fps")) and object.&lt;PROPERTY_PATH&gt; with the Python member path (e.g. object.description, object.lengthInBeats, object.player.tRender); (2) each template carries its own variable name (tplString, tplSetNumber, ...); rename it to something meaningful for that object/property pair (letters, digits, '_', '-' and '.') and change every $(liveupdate:...) in the button text and in the actions to the new name. One variable name must watch exactly one object/property pair: the module refuses a second subscription for a name that is already bound elsewhere and says so in the log, because the Set / Toggle actions find their subscription by variable name; two buttons watching the same path must use the same variable name, and their shared subscription runs at the fastest Update Frequency any of them asks for; (3) keep Update Frequency above 0 (prefilled from the State interval setting, 500 ms). Set / Nudge / Toggle actions do not take paths: they write to the subscription that owns the variable name, which is why each control template carries the matching feedback. Number values are JavaScript expressions evaluated after variable substitution ($(liveupdate:myValue)+1 works; the result must be a finite number); Boolean is a checkbox; JSON is a partial object merged into the property ({"x": 0.0} changes only x of a vector); String is sent verbatim. Object, array and resource values ({uid, path, type}) arrive as JSON strings, so use jsonparse / jsonpath in expressions (see Watch: JSON field x). A readout shows ERROR or PATH_ERROR when the Director rejects the path; fix the path, the module resubscribes on its own. The button texts show such a marker (and OFFLINE or UNSET) as it is rather than formatting it: keep the isNumber(...) / jsonparse(...) === null guard when you edit a text.

| Preset | What it does | Object path | Property path | Variable | Kind |
|---|---|---|---|---|---|
| Watch: String | Generic readout of any string-valued property; plain text mode so the raw value (or ERROR / PATH_ERROR) is shown unchanged. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplString` | readout |
| Watch: Number (2 dp) | Generic readout of any numeric property formatted to two decimals. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplNumber` | readout |
| Watch: JSON field x | Generic readout of one field of an object/vector/resource value, which the module delivers as a JSON string. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplJson` | readout |
| Set Number 0 | Generic setter that writes a literal number (0) to the watched property and shows the current value. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplSetNumber` | set value |
| Set String | Generic setter that writes a literal string to the watched property and shows the current value. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplSetString` | set value |
| Set Boolean true | Generic enable button: writes true to the watched boolean property. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplBoolTrue` | set on/off |
| Set Boolean false | Generic disable button: writes false to the watched boolean property. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplBoolFalse` | set on/off |
| Toggle Boolean | Generic toggle for a boolean property: the Toggle Disguise Boolean action writes the opposite of the current value. | `<OBJECT_PATH>` | `object.<PROPERTY_PATH>` | `tplToggle` | toggle |
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
| [EXP] EV error text by device+index | Health readout: error text of the i-th variable (duplicate definition or bad Function expression); an empty line is assumed OK. | `expressionvariablesdevice:"$(liveupdate:selEvDevice)"` | `object.container.variables[$(liveupdate:selEvIndex)].errorText` | `evDevError` | readout |
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

- **Variable Name**: name of the variable: letters, digits, `_`, `-` and `.`, the characters Companion
  itself accepts in a variable id. A leading digit is allowed and there is no length limit. A name
  with any other character (a space, for example) is never subscribed, and the log says so once. The
  module's own variables (see *Variables*) are reserved: a feedback that uses one of those names is
  never subscribed either, and the log says so once.
- **Object Path**: Designer expression, e.g. `track:"Track 1"`, `screen2:"Surface 1"`, `Machine:"Director"`, `getByUID(0x...)`, `subsystem:MonitoringManager.findLocalMonitor("fps")`. Companion variables are expanded before the subscription is made.
- **Property Path**: Python expression on `object`, e.g. `object.lengthInBeats`, `object.player.tRender`, `object.seriesAverage("Actual", 1)`
- **Update Frequency (ms)**: minimum time between updates (`0` = as fast as possible, the Director's
  default). Feedbacks that share a property run at the fastest interval any of them asks for.

The feedback itself applies no style; use *LiveUpdate Compare* or Companion expressions for colours.

### LiveUpdate Compare

Boolean feedback on the current value of a LiveUpdate Variable: equals, not equal, less / less or
equal / greater / greater or equal (numeric), is true / non-zero / non-empty, contains text. Add it to
any button, together with a LiveUpdate Variable feedback of the same name somewhere in the config.

A value that is unknown satisfies no comparison, not even *not equal* or *is true*: no value yet,
`null` (Python `None`), a Director error, or one of the words `PENDING`, `OFFLINE`, `ERROR`,
`PATH_ERROR`, `PATH_ERROR (unsubscribed)` and `UNSET`, also when the Director itself sends that text.
A `PATH_ERROR` therefore never lights a "not equal" alarm: the button keeps its own colour and its
text shows the word.

### LiveUpdate Sparkline

Draws the recent values of a LiveUpdate Variable as a line on the button: *Variable Name*, *Samples
to keep* (4..300, default 60), *Scale to the values seen* or a fixed *Minimum* / *Maximum*, *Line
colour*, *Fill under the line* and *Draw a threshold line* with its *Threshold*. On Companion 5 the
button needs an Image layer; see *Seeing a trend*.

### Command armed

True on the button whose press armed a destructive command, until the second press sends it or
*Confirm within (s)* runs out. See *Commands*.

### Last command failed

True while `rest_last_status` is `FAILED` or `UNSUPPORTED`, that is while the last command this
connection sent did not succeed. It covers the whole connection. A press refused before sending does
not change it.

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

A Number value is evaluated after its variables are parsed and only a finite number is sent. A value
that refers to a readout of this connection, such as `$(liveupdate:brightness)-0.05`, is not sent
while that readout has no numeric value yet (it is empty, `PENDING`, `OFFLINE`, `UNSET`, ...): the
expression would reach the Director as an absolute value. The check recognises the connection's own
label, so it works for `liveupdate_2` or a renamed connection, and for variable names that contain `-`
or `.`.

Writes to the same property in quick succession (a rotary encoder) are collapsed: the first goes out
at once, then one write per 40 ms carries the latest value.

### Toggle Disguise Boolean

Flips a boolean property using the current value of its LiveUpdate Variable. Nothing is sent while
the readout holds no on/off value (true / false, 1 / 0).

### Selections

- **Set selection**: sets one selection variable (dropdown) to a value (variables allowed, e.g.
  `$(custom:show_track)`) and stores it in the connection settings. Put it on a button to switch every
  track preset to another track in one press. A value that parses to `$NA` or to an unresolved
  reference clears the selection.
- **Set selection: Track**, **Set selection: Layer**, ...: one action per selection, with the names
  read from the Director as a dropdown (see *Choosing selections from the Director*).
- **Set selection profile**: several selections with one press; an empty field leaves its selection
  unchanged.
- **Refresh selection lists**: read the lists again, for example after the show file changed.

### Check presets against this Director

Checks every preset property whose selections are filled in; see *Checking the presets on your
Director*.

### Commands

The *Transport:*, *RenderStream:* and *Failover:* actions and *Command: rescan the command API*; see
*Commands*.

## Variables

- `connection_status`: `Connected` / `Disconnected` (empty until the first connection attempt has an
  outcome)
- `designer_version`: Designer version of the connected Director (empty until it has been read, and
  emptied when the host or port changes)
- `selfcheck_progress`, `selfcheck_ok`, `selfcheck_failed`, `selfcheck_skipped`: the preset check
  (empty until it first runs)
- `rest_last_command`, `rest_last_status`, `rest_last_message`: the last command sent and its result
  (empty until the first command is sent)
- `rest_armed`: the most recent destructive command waiting for its second press (empty when none)
- `selTrack`, `selLayer`, ...: the selections (see *Selections*), `$NA` while empty
- one variable per placed LiveUpdate Variable feedback, named as configured (see *What a readout
  shows*)

The module's own variables exist from the moment the connection starts, so a button text that uses
one shows it empty, not `$NA`, until it has a value. The selections are the exception: an empty
selection holds the text `$NA` itself.

All of the module's own variables above, the selection ids included, are reserved and cannot be used
as LiveUpdate Variable names. Only the exact selection ids are reserved, not every name starting with
`sel`.

## Using with the OSC module

This module sends the transport commands itself (see *Commands*), so
[companion-module-disguise-osc](https://github.com/bitfocus/companion-module-disguise-osc) is
optional. It can sit on the same page, for example for its fades. The transport presets use the OSC
module's variable ids where the value matches, so button expressions can be moved between the two;
all of these presets except *Connection status* (`01 Connection`) are in `04 Transport State`:

| OSC module variable | LiveUpdate preset / variable | Notes |
|---|---|---|
| `trackname` | `Current track name` / `trackname` | |
| `playMode` | `Play mode (string)` / `playMode` | Python string of the play mode |
| `brightness`, `volume` | `Master brightness` / `Master volume` | writable here (nudges, full, zero) |
| `bpm` | `BPM at playhead` / `bpm` | |
| `currentSectionName`, `nextSectionName` | `Current section name` / `Next section name` | |
| `sectionElapsed`, `sectionRemaining` | `Section elapsed (beats)` / `Section remaining (beats)` | **beats**, not seconds |
| `trackposition`, `timecodeposition` | `Track position (seconds)` / `Timecode position` | |
| `heartbeat` | `Connection status` / `connection_status` | |

## Object path reference

- `type:name` finds a resource by type and name: `track:"Track 1"`, `screen2:"Surface 1"`,
  `projector:"Projector 1"`, `ledscreen:"LED 1"`, `Machine:"Director"`, `transportManager:default`.
  Names with spaces need the quotes; older Designer versions only accept the sanitised form
  (`track:track_1`).
- `getByUID(0x...)` finds any resource by UID, independent of its name (right-click the editor
  title bar > Copy UID).
- `subsystem:MonitoringManager` and `subsystem:RenderStreamSystem` address the subsystems shown in
  the LiveUpdate documentation. `subsystem:D3NetManagerSystem`, `subsystem:GuiSystem` and
  `subsystem:SessionSystem` are not shown there; the presets that use them were confirmed on r34.0.3.
- Chained calls are allowed in the object part: `track:"Track 1".findLayerByName("Video 1")`,
  `subsystem:MonitoringManager.findLocalMonitor("fps")`.
- Remote monitors take the node name `"<hostname>:d3"`.
- Documented monitor names: `fps` (series `Actual`), `GPUProfiler` and `CPU` (series `Total`),
  `GPUMemory` (`Usage(MB)`), `ProcessMemory` (`Usage (MB)`).

## Troubleshooting

Look at the button first: a readout shows what went wrong (see *What a readout shows*).

- `UNSET`: the path cannot be resolved yet. Usually the selection the preset depends on is empty;
  fill it in. The log says "Not subscribing feedback ...: the path cannot be resolved yet".
- `PENDING`: the module has asked the Director and waits for the answer; it normally lasts a moment.
  A request that stays unanswered for the *Pending Subscription Timeout* is dropped and made again
  with the back-off, and the readout keeps saying `PENDING` (the log says "Pending subscription timed
  out").
- Empty: the Director's value is empty (an empty text or `None`). If you expected a value, check that
  no other feedback watches the same property under a different Variable Name: only the first name
  receives the values (the log says "Feedbacks share ... with different variable names").
- `$NA`: the variable name in the button text matches no feedback of this connection. Check the
  spelling against the feedback's Variable Name, and the connection label (`$(liveupdate:...)`).
- `OFFLINE`: the connection to the Director is closed; `connection_status` says `Disconnected` and
  the module reconnects on its own.
- `ERROR`: the Director could not resolve the object path (wrong name, wrong type prefix, object does
  not exist). The subscription is retried with a growing back-off (2 s doubling up to 60 s) until you
  fix the path.
- `PATH_ERROR` / `PATH_ERROR (unsubscribed)`: the object exists but the property expression fails;
  after three errors in a row the module unsubscribes and retries with the same back-off (reset by the
  first good value or by editing the feedback).
- Log says "Selection rejected": the value a *Set selection* action sent contains characters that are
  not allowed for that selection (see *Selections*), and the selection keeps its previous value.
  "Selection ignored": a value in the connection settings is invalid, and the selection counts as
  empty (`$NA`) until it is corrected.
- Log says "Variable name '...' is reserved for the module" or "LiveUpdate Variable feedback ... needs
  a Variable Name": give the feedback a name of its own.
- Log says "Variable '...' is already watching ...": one variable name watches one object/property
  pair; give the second feedback its own name (and change it in its button text and actions).
- A control does nothing: the button needs the LiveUpdate Variable feedback with the same variable
  name; check the log for "No LiveUpdate Variable found" or, for a nudge, "Not writing: '...' has no
  numeric value yet".
- A command button does nothing: check the log. "Command channel is off", "is a destructive command;
  enable ...", "... is empty or unresolved, nothing was sent" and "Armed '...'. Press again within
  ..." are refusals or arms; nothing was sent.
- Connection closes right after a set: wrong value type for the property, see *Set to Disguise*.
- Values are in **beats** unless stated otherwise (track time); `beatToTime` converts to seconds.

## Limits

- LiveUpdate itself carries properties only. The commands go over the Session REST API on the same
  host and port; a command the Designer build does not have is reported as `UNSUPPORTED`.
- Starting, stopping and restarting RenderStream layers and the failover commands were never sent to
  a Director during verification (a second command does not undo them); their paths and bodies come
  from the Director's own OpenAPI document.
- Whether a property accepts a set can only be found out by trying; the presets only ship writes on
  members that have a setter in the Designer API.
- Object paths in `99 Experimental` are not documented by disguise and may fail on your version.
- On Companion 5 the Sparkline needs an Image layer on a button that was not placed from a preset
  (see *Seeing a trend*).

## Links

- [LiveUpdate API](https://developer.disguise.one/api/session/liveupdate)
- [Monitoring machine health](https://developer.disguise.one/api/guides/monitoring)
- [Designer expressions: accessing resources](https://help.disguise.one/designer/configuration/expressions/accessing-resources)
- [Python API type stubs](https://developer.disguise.one/assets/d3.pyi)
- Module source, catalog and verification notes: `docs/` in the repository
