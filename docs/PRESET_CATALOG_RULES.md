# Preset catalog design rules (Phase 1, v1)

These rules govern every row of `PRESET_CATALOG.md`. They were fixed after the Phase 0 review
(2026-09-03): inferred candidates are isolated in an Experimental tier that is read-only and hidden
behind a connection setting; update intervals are prefilled from connection settings; the library
must stay compatible with a future pairing with `companion-module-disguise-osc`.

## 1. Tiers and verification status

| tier | source status (PHASE0_CANDIDATES) | catalog status | category | name prefix | writes |
|---|---|---|---|---|---|
| normal | doc-verified | `doc-verified`, or `live-verified` when the exact pair returned a value on r34.0.3 (Phase 3) | 01–11 | none | allowed when the member has a setter or the doc shows a set |
| experimental | inferred | `unverified`, or `live-verified` when confirmed live (kept experimental until promoted) | `99 Experimental` | `[EXP] ` | **never** (read-only rows only) |
| excluded | unverified, reject, inferred writes | — | — | — | — |

Experimental presets are generated only when the connection setting `showExperimentalPresets` is
on (default off). Their preset ids and variable names are identical to what they would be after
promotion, so promotion changes only the category and the name prefix.

Phase 3 (2026-09-04) checked the catalog read-only against a Designer r34.0.3 Director
(`scripts/live-verify.mjs`, evidence in `docs/research/live-verification*.json`); every row carries a
`live` result rendered in the *live* column of PRESET_CATALOG.md. Rows whose subscription the Director
rejects are corrected or removed before release, never shipped as they are. Rows that fail only because
the test project lacks a feature (timecode source, Expression Variables device, running RenderStream
workload, LED/DMX screens) keep their tier with the Director's message as a note. Live-confirmed
experimental rows are promotion candidates; promotion is decided per row with the user and, by the
rule above, changes only category and name prefix. On 2026-09-04 the user decided to promote every
live-confirmed experimental row (103 rows, listed under `promotion` in the catalog JSON); the
selections they use (selLedScreen, selStageUid, selRsLayer) became regular selections at the same time.

Write verification (2026-09-04) covers the `writable: yes` rows: `scripts/live-write-verify.mjs` reads
the current value, writes a small change, confirms it through the subscription, writes the original
value back, confirms that, and re-reads everything at the end; an interrupt restores the value in
flight before exiting. Targets are grouped: `neutral` touches only a track that is not the
transport's current track, `output` touches master fades, hold and stage flags and refuses to run
while the transport plays. Both guards fail closed: `neutral` is refused when the track it would use
is the current one or the current track cannot be read, `output` when the playing state cannot be
read. `--force` overrides them. Failover topology (Machine role / targets / hostname) is never
written. A row that was written and restored carries a `write` object, rendered in the *write* column
of PRESET_CATALOG.md.

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
variables are what that rewrite is for, with one gap: Companion 5.0.4 rewrites the label in a
preset's button text, style overrides and action options, but not in its feedback options. The
catalog keeps writing `$(liveupdate:...)`, and `src/presets.ts` replaces that label with the
connection's own (`instance.label`) in the LiveUpdate Variable paths and the Compare value, so a second
connection (`liveupdate_2`) or a renamed one follows its own selections. A rename reaches
`configUpdated`, which publishes the presets again; buttons placed before the rename are relabelled
by Companion. The library therefore uses module-owned *selection variables* (extension 7 in §11):

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
| `$(liveupdate:selLedScreen)` | `ledscreen:"$(liveupdate:selLedScreen)"` | `LED 1` |
| `$(liveupdate:selStageUid)` | `getByUID($(liveupdate:selStageUid))` | `0x0123456789abcdef` |
| `$(liveupdate:selRsLayer)` | `getLeafLayers(RenderStreamModule)[$(liveupdate:selRsLayer)]` inside the property path, on `track:"$(liveupdate:selTrack)"` | `0` |
| experimental: `selTransport`, `selDmxScreen`, `selEvDevice`, `selEvName`, `selEvLayer` | Experimental rows only | — |

`selLedScreen`, `selStageUid` and `selRsLayer` started as experimental selections and became regular
ones when their rows were promoted after the 2026-09-04 live run (§1).

Selection variables are ordinary module variables: their values come from a "Selections" section in
the connection settings and can be changed live with a `Set selection` action (value field with
`useVariables`, so `$(custom:...)` or `$(internal:...)` can feed them). Changing a selection
re-points every preset that uses it; existing buttons keep their own paths if the operator edited
them.

Rules:
- Quoted names (`track:"..."`) are used everywhere so names with spaces work (Designer r34 supports the quoted form; the sanitised `track_1` form is documented as the legacy fallback).
- `transportManager:default` (casing as in disguise's own plugin guide) and `subsystem:...` paths carry no variable.
- Selection references never appear in `variableName` (that option is not parsed).
- `11 Templates` uses literal `<OBJECT_PATH>` / `<PROPERTY_PATH>` placeholders. The module's guard (`isUnresolvedPath` and `isUnresolvedObjectPath` in `src/index.ts`) never subscribes while a path is empty or contains an `<UPPER_CASE>` placeholder token, `$NA` or an unparsed `$(...)` reference, nor while an object path is a bare empty name (`track:""` / `track:''`) or the remote-node form without a hostname (`":d3"`); the readout shows `UNSET` and the refusal is logged once per feedback. Everything else is sent as written, because `""`, `[]` and `(1,)` are ordinary Python in a property path (several shipped paths end in `else ""`) and `findLayerByName("")` is a path the Director answers with a visible `ERROR` or `PATH_ERROR`. Unset selections publish `$NA`, so every preset built on them is covered whatever the slot looks like.
- Selection values are validated by kind before use (`src/selections.ts`): names must not contain quotes, backslashes or line breaks; hosts are `[A-Za-z0-9._-]`; indices are plain decimal integers; UIDs are decimal or `0x` hex integers. Invalid values are rejected in the Set selection action and ignored (treated as unset) when read from the config.
- Rejected alternatives: (a) literal `<TRACK_NAME>` placeholders in every path: one edit per button, no central re-pointing, and they trigger the subscribe-storm hazard until edited; they remain the documented manual fallback. (b) `$(custom:...)` inside shipped presets: broken by the host's label rewrite (above); operators may still type it into a placed button.

## 5. Variable names

- `variableName` is `[A-Za-z0-9_]`, ≤ 40 characters, semantic (not preset-based). This is the library's own convention; the module accepts any name Companion accepts as a variable id (letters, digits, `_`, `-` and `.`, a leading digit included, no length limit) and refuses only its own variable ids (`connection_status`, `designer_version`, `selfcheck_*`, `rest_*` and the selection ids).
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

Presets that share a pair share one Director subscription, which runs at the fastest interval any
placed feedback asks for (`0`, the Director default, beats any number); that is why a pair keeps one
frequency class across the library (§5).

## 7. Button style

- Readouts: bgcolor `rgb(40,40,43)` (MatteBlack) and colour `rgb(220,220,220)` (Gainsboro), the disguise-osc palette, so both modules look coherent on one page. Size `auto`. Text is `Title\nvalue`; `textExpression: true` whenever formatting is needed (`toFixed`, `secondsToTimestamp`, `jsonparse`).
- An expression text formats only a value of the kind it expects and shows anything else as it is, so the readout markers (`OFFLINE`, `ERROR`, `PATH_ERROR`, `PATH_ERROR (unsubscribed)`, `UNSET`, `SENTINELS` in `src/variables.ts`) and an undefined value (`$NA`) reach the button: booleans compare strictly (`V === true ? .. : V === false ? .. : V`), numbers and numeric enums are guarded with `isNumber()`, units sit inside the guarded branch, and JSON rows fall back to the raw value when `jsonparse()` returns null. `scripts/gen-presets.mjs` refuses a text that hides a marker or an undefined value or renders NaN (rendered with Companion 5.0.4's semantics by `scripts/companion-expression.cjs`).
- Controls: amber `rgb(140,70,0)` for writes (nudge / set), green `rgb(0,100,0)` for enable / on, FireBrick `rgb(178,34,34)` for disable / hold / off.
- Experimental: bgcolor `rgb(70,70,90)`.
- `previewStyle` shows a representative value so the preset browser is readable.
- Readouts do **not** stack the `connectionState` feedback (its green override would hide the readout colour); `01 Connection` provides the connection indicator once.
- Colour-by-value needs a boolean feedback. Rows may declare a `stateColour` rule; it becomes a `liveUpdateCompare` feedback (extension 3, implemented) on the same variable with the given operator, value and background colour.

## 8. Row composition

| controlKind | feedbacks | actions |
|---|---|---|
| readout | `liveUpdateVariable` | none |
| nudge | `liveUpdateVariable` | `setToDisguiseNumber` with `$(liveupdate:<var>)+<step>` on `down`; optional `rotate_left` / `rotate_right` with ∓/±step |
| setValue | `liveUpdateVariable` | `setToDisguiseNumber` / `setToDisguiseString` with a literal value |
| onOff | `liveUpdateVariable` | `setToDisguiseBoolean` with `value: true` or `false` (one preset each) |
| toggle | `liveUpdateVariable` | `setToDisguiseToggle` (extension 4, implemented); the onOff pair stays available as explicit ON / OFF buttons |
| jsonSet | `liveUpdateVariable` | `setToDisguiseJSON` with a partial object (`{"x": 0.0}`) |

Every row records the candidate ids it is built from, the source (URL or `d3.pyi:line`), the
Designer version notes, a live-test priority, and the number of subscriptions it creates (normally 1).

## 9. Property path constraints

- Python 2.7 expression only (no f-strings, no statements); no mutating calls. Comprehensions were originally restricted to Experimental rows; after the 2026-09-04 live run the ones that returned a value were promoted with their category, so default-tier rows may contain a comprehension when the exact expression is live-verified.
- Only members present in `d3.pyi` r34.0 and cited in `PHASE0_CANDIDATES.md`; no new paths may be introduced in Phase 1.
- In the object part, logical operators are functions (`and(x, y)`), not keywords.

## 10. OSC parity and future integration

`04 Transport State` (normal tier) covers the disguise-osc variables `trackname`, `playMode`,
`brightness` and `volume`, and also `bpm`, `currentSectionName`, `nextSectionName`,
`sectionElapsed`, `sectionRemaining`, `trackposition` and `timecodeposition`. Those seven started
as experimental rows (their expressions are chains that the LiveUpdate documentation does not show),
returned a value on the 2026-09-04 r34.0.3 live run and were promoted with the OSC ids unchanged.
`sectionElapsed` and `sectionRemaining` are in beats, not seconds.

Transport commands cannot travel over LiveUpdate. The module sends them over the Session REST API
as its `Transport:` actions (play, stop, section and track jumps, go to time / timecode / note / tag,
brightness, volume, speed, engaged), next to the `RenderStream:` and `Failover:` actions, so
disguise-osc is no longer needed for them; it can still share a page, for example for fades. The
catalog ships no command presets. Categories, colours and variable ids are aligned so that a combined
page needs no renaming.

## 11. Module extensions required by the catalog (each a separate, backward-compatible commit)

All items below are implemented on the branch `feat/preset-library` (Phase 2). The commit subjects are
given instead of hashes, which do not survive a rebase or a squash merge.

1. Unresolved-path guard and back-off ("feat: guard unresolved paths and back off after subscription errors", "fix: de-duplicate subscriptions, retry on a timer and validate selections"): never subscribe while a path is empty or contains an `<UPPER_CASE>` placeholder, `$NA` or an unparsed `$(...)`, nor while an object path is a bare empty name (`track:""`) or `":d3"` (see §4); the readout shows `UNSET`. After a failed subscription (Director error, three property-path errors, or a pending request that times out) the feedback backs off 2 s doubling up to 60 s, a timer of its own re-evaluates it when the delay elapses, and the back-off is cleared by the first good value or by editing the feedback. Subscribe requests are joined while in flight and shared subscriptions are reference counted.
2. Connection settings `showExperimentalPresets` and the four `presetInterval*` fields ("feat: add preset interval and experimental preset settings").
3. `liveUpdateCompare` boolean feedback ("feat: add LiveUpdate Compare feedback").
4. `setToDisguiseToggle` action ("feat: add Toggle Disguise Boolean action").
5. `companion/manifest.json` `apiVersion: 0.0.0`, `@companion-module/base` pinned to `~1.13.2` ("chore: reset manifest apiVersion and pin module-base").
6. ESLint 9 flat configuration, prettier and devDependency alignment ("chore: add ESLint 9 flat config and align dev dependencies").
7. Selection variables ("feat: add selection variables and Set selection action", validation in "fix: de-duplicate subscriptions, retry on a timer and validate selections"): module variables `selTrack`, `selLayer`, `selLayerIndex`, `selSection`, `selBeat`, `selScreen`, `selProjector`, `selScreenUid`, `selMachine`, `selHost`, `selWorkload`, `selInstance`, `selEvUid`, `selEvIndex`, `selLedScreen`, `selStageUid`, `selRsLayer` (plus the experimental set) fed from a "Selections" block of the connection settings and from the `setSelection` action; values are validated by kind, persisted with `saveConfig`, and published as `$NA` while unset. The selection ids and the module's other own variables (`connection_status`, `designer_version`, `selfcheck_*`, `rest_*`) are reserved variable names.
8. `configUpdated` keeps the WebSocket when only preset settings or selections changed ("feat: add selection variables and Set selection action").
9. Every variable owned by a placed LiveUpdate Variable feedback stays defined, the Connection OK feedback is re-evaluated on connect/disconnect, and editing Update Frequency re-subscribes ("fix: de-duplicate subscriptions, retry on a timer and validate selections").
