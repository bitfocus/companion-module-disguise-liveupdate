# Preset catalog design rules (Phase 1, v1)

These rules govern every row of `PRESET_CATALOG.md`. They were fixed after the Phase 0 review
(2026-09-03): inferred candidates are isolated in an Experimental tier that is read-only and hidden
behind a connection setting; update intervals are prefilled from connection settings; the library
must stay compatible with a future pairing with `companion-module-disguise-osc`.

## 1. Tiers and verification status

| tier | source status (PHASE0_CANDIDATES) | catalog status | category | name prefix | writes |
|---|---|---|---|---|---|
| normal | doc-verified | `doc-verified` (→ `live-verified` after Phase 3) | 01–11 | none | allowed when the member has a setter or the doc shows a set |
| experimental | inferred | `unverified` | `99 Experimental` | `[EXP] ` | **never** (read-only rows only) |
| excluded | unverified, reject, inferred writes | — | — | — | — |

Experimental presets are generated only when the connection setting `showExperimentalPresets` is
on (default off). Their preset ids and variable names are identical to what they would be after
promotion, so promotion changes only the category and the name prefix.

## 2. Categories

Companion 5 sorts categories by name, so every category carries a numeric prefix.

| category | prefix of preset ids | content |
|---|---|---|
| `01 Connection` | `conn_` | connection state, connection_status text |
| `02 Monitoring Local` | `monl_` | local MetricMonitor readouts |
| `03 Monitoring Remote` | `monr_` | remote MetricMonitor readouts (`<host>:d3`) |
| `04 Transport State` | `tr_` | read-only transport state, master brightness / volume controls |
| `05 Track & Layer` | `trk_` | track / section / layer inspection |
| `06 Layer Control` | `lay_` | layer enable, keyframe value read/write |
| `07 Stage & Screen` | `stg_` | screen2 / projector readouts and controls |
| `08 Expression Variables` | `ev_` | ExpressionVariablesDevice reads (by UID) |
| `09 RenderStream` | `rs_` | workload / instance health |
| `10 Failover & d3Net` | `fo_` | machine failover / network state by machine name |
| `11 Templates` | `tpl_` | generic watch / set presets with literal placeholders |
| `99 Experimental` | home prefix | inferred read-only rows from any category |

Each category starts with one `type: 'text'` preset (id `<prefix>_setup`) whose text lists the
custom variables to create and what the presets show. Categories 02–10 may add further text
headings to separate readouts from controls.

## 3. Preset ids and names

- id: `<prefix>_<slug>`, lowercase `[a-z0-9_]`, unique across the library, stable forever.
- name: English, ≤ 40 characters, noun phrase (`FPS (latest)`, `Master brightness −0.05`).
- Experimental names get the `[EXP] ` prefix in the generated definitions only.

## 4. Object paths: module-owned selection variables

The feedback options `objectPath` and `propertyPath` are `textinput` fields with `useVariables`.
Since module API 1.13 (Companion 4.1+) the host parses `$(...)` references in such fields before
the feedback is delivered, tracks the referenced variables, and re-sends the feedback when they
change (Companion 5.0.4 `EntityManager.parseEntityOptions` / `onVariablesChanged`). The module
then sees a changed path and re-subscribes (`checkAndUpdateSubscription`).

A preset cannot ship `$(custom:...)` references, though: when presets are imported, Companion
rewrites every `$(label:var)` whose label is not `local` to the connection's label
(`Definitions.ts` → `replaceAllVariables`, `preserveLabels = {'local'}`), so `$(custom:d3_track)`
would become `$(<connection>:d3_track)` and resolve to `$NA`. References to the module's **own**
variables survive the rewrite correctly. The library therefore uses module-owned *selection
variables* (extension 7 in §11):

| selection variable | used in | example value |
|---|---|---|
| `$(liveupdate:selTrack)` | `track:"$(liveupdate:selTrack)"` | `Track 1` |
| `$(liveupdate:selLayer)` | `track:"$(liveupdate:selTrack)".findLayerByName("$(liveupdate:selLayer)")` | `Video 1` |
| `$(liveupdate:selLayerIndex)`, `selSection`, `selBeat` | index / beat arguments in the track probes | `0`, `2`, `32` |
| `$(liveupdate:selScreen)` | `screen2:"$(liveupdate:selScreen)"` | `LED Wall` |
| `$(liveupdate:selProjector)` | `projector:"$(liveupdate:selProjector)"` | `projector 1` |
| `$(liveupdate:selScreenUid)` | `getByUID($(liveupdate:selScreenUid))` | `0x0123456789abcdef` |
| `$(liveupdate:selMachine)` | `Machine:"$(liveupdate:selMachine)"` | `VX4-01` |
| `$(liveupdate:selHost)` | `findRemoteMonitor("$(liveupdate:selHost):d3", ...)` | `VX4-02` |
| `$(liveupdate:selWorkload)`, `selInstance` | RenderStream workload id / instance index in the property path | `12345`, `0` |
| `$(liveupdate:selEvUid)`, `selEvIndex` | Expression Variables device UID / variable index | — |
| experimental: `selTransport`, `selLedScreen`, `selDmxScreen`, `selStageUid`, `selEvDevice`, `selEvName`, `selEvLayer`, `selRsLayer` | Experimental rows only | — |

Selection variables are ordinary module variables: their values come from a "Selections" section in
the connection settings and can be changed live with a `Set selection` action (value field with
`useVariables`, so `$(custom:...)` or `$(internal:...)` can feed them). Changing a selection
re-points every preset that uses it; existing buttons keep their own paths if the operator edited
them.

Rules:
- Quoted names (`track:"..."`) are used everywhere so names with spaces work (Designer r34 supports the quoted form; the sanitised `track_1` form is documented as the legacy fallback).
- `transportManager:default` (casing as in disguise's own plugin guide) and `subsystem:...` paths carry no variable.
- Selection references never appear in `variableName` (that option is not parsed).
- `11 Templates` uses literal `<OBJECT_PATH>` / `<PROPERTY_PATH>` placeholders; the Phase 2 guard skips subscribing while a path contains `<`, `>`, `$NA`, an unparsed `$(` or an empty quoted name `""`.
- Rejected alternatives: (a) literal `<TRACK_NAME>` placeholders in every path: one edit per button, no central re-pointing, and they trigger the subscribe-storm hazard until edited; they remain the documented manual fallback. (b) `$(custom:...)` inside shipped presets: broken by the host's label rewrite (above); operators may still type it into a placed button.

## 5. Variable names

- `variableName` is `[A-Za-z0-9_]`, ≤ 40 characters, semantic (not preset-based).
- Exactly one variable name per unique (objectPath, propertyPath) pair in the whole library; every preset that subscribes to that pair uses the same name and the same frequency class.
- Names mirror `companion-module-disguise-osc` where the meaning matches: `trackname`, `currentSectionName`, `nextSectionName`, `sectionElapsed`, `sectionRemaining`, `volume`, `brightness`, `bpm`, `playMode`, `trackposition`, `timecodeposition`. Everything else is lowerCamelCase (`fps`, `fpsAvg10`, `gpuTotalMs`, `playheadBeats`, `isPlaying`, `layerEnabled`, `screenOffsetX`).
- Duplicating a preset for a second object requires renaming the variable in the feedback and in the button text; the HELP documents this.

## 6. Update frequency classes

| class | default (ms) | used for | rationale |
|---|---|---|---|
| monitoring | 1000 | MetricMonitor values, RenderStream counters | Director pushes every frame (60 Hz) when unthrottled; a button readout needs ≤ 1–2 Hz; the guide's 100 ms examples are for dashboards |
| playhead | 250 | tRender / tCurrent, section remaining | 4 Hz keeps a timecode readout smooth without flooding Companion's variable system |
| state | 500 | booleans, enums, strings, brightness / volume, health | change-driven values; 500 ms caps bursts |
| static | 5000 | names, lengths, lists, versions | change only on edit; the Director still delivers a change within one cycle |

The defaults live in connection settings (`presetIntervalMonitoring`, `presetIntervalPlayhead`,
`presetIntervalState`, `presetIntervalStatic`); presets are generated from them in `applyConfig`,
so editing the settings changes the prefilled value of presets dragged afterwards. Every placed
button keeps its own editable `updateFrequency`. `0` (unthrottled) is never a library default.

## 7. Button style

- Readouts: bgcolor `rgb(40,40,43)` (MatteBlack) and colour `rgb(220,220,220)` (Gainsboro), the disguise-osc palette, so both modules look coherent on one page. Size `auto`. Text is `Title\nvalue`; `textExpression: true` whenever formatting is needed (`toFixed`, `secondsToTimestamp`, `jsonparse`).
- Controls: amber `rgb(140,70,0)` for writes (nudge / set), green `rgb(0,100,0)` for enable / on, FireBrick `rgb(178,34,34)` for disable / hold / off.
- Experimental: bgcolor `rgb(70,70,90)`.
- `previewStyle` shows a representative value so the preset browser is readable.
- Readouts do **not** stack the `connectionState` feedback (its green override would hide the readout colour); `01 Connection` provides the connection indicator once.
- Colour-by-value needs a boolean feedback. Rows may declare a `stateColour` rule; it is implemented only if the proposed `liveUpdateCompare` feedback (extension 3) is approved.

## 8. Row composition

| controlKind | feedbacks | actions |
|---|---|---|
| readout | `liveUpdateVariable` | none |
| nudge | `liveUpdateVariable` | `setToDisguiseNumber` with `$(liveupdate:<var>)+<step>` on `down`; optional `rotate_left` / `rotate_right` with ∓/±step |
| setValue | `liveUpdateVariable` | `setToDisguiseNumber` / `setToDisguiseString` with a literal value |
| onOff | `liveUpdateVariable` | `setToDisguiseBoolean` with `value: true` or `false` (one preset each) |
| toggle | `liveUpdateVariable` | proposed `setToDisguiseToggle` (extension 4); until approved, shipped as an onOff pair |
| jsonSet | `liveUpdateVariable` | `setToDisguiseJSON` with a partial object (`{"x": 0.0}`) |

Every row records the candidate ids it is built from, the source (URL or `d3.pyi:line`), the
Designer version notes, a live-test priority, and the number of subscriptions it creates (normally 1).

## 9. Property path constraints

- Python 2.7 expression only (no f-strings, no statements); comprehensions allowed but only in Experimental rows; no mutating calls.
- Only members present in `d3.pyi` r34.0 and cited in `PHASE0_CANDIDATES.md`; no new paths may be introduced in Phase 1.
- In the object part, logical operators are functions (`and(x, y)`), not keywords.

## 10. OSC parity and future integration

`04 Transport State` provides a read-only counterpart for each disguise-osc variable listed in §5.
Transport commands (play, stop, cue, fades) are not available through LiveUpdate; the HELP explains
building one page with disguise-osc for commands and this module for state. Categories, colours and
variable ids are aligned so that a later merge or a combined page needs no renaming.

## 11. Module extensions required by the catalog (each a separate, backward-compatible commit)

1. Placeholder / error guard: skip subscribing while a path contains `<`, `>`, `$NA` or `$(`; exponential back-off after subscription errors (approved).
2. Connection settings: `showExperimentalPresets` (checkbox, default off) and the four `presetInterval*` fields (approved).
3. `liveUpdateCompare` boolean feedback (variable name, operator, value) for colour-by-value (proposed).
4. `setToDisguiseToggle` action (variable name) for boolean toggles (proposed).
5. `companion/manifest.json` `apiVersion: 0.0.0`, `@companion-module/base` pinned to `~1.13.2` (approved).
6. ESLint configuration and devDependency alignment (approved).
7. Selection variables (proposed, replaces the custom-variable plan): module variables `selTrack`, `selLayer`, `selLayerIndex`, `selSection`, `selBeat`, `selScreen`, `selProjector`, `selScreenUid`, `selMachine`, `selHost`, `selWorkload`, `selInstance`, `selEvUid`, `selEvIndex` (plus the experimental set) fed from a "Selections" block of connection settings and from a `setSelection` action (dropdown of selection names + value textinput with `useVariables`); values persist in the config via `saveConfig`. No change to existing actions/feedbacks.
