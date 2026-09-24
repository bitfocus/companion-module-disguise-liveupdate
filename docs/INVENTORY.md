# Module inventory — companion-module-disguise-liveupdate (Phase 0)

Snapshot of what the module implemented when this work started, taken from `src/` at upstream `main`
(commit `0d9895c`; `src/` is byte-identical to tag `v1.0.2`, later commits only bump dependencies).
Everything below was read from the code, the installed `@companion-module/base` type definitions
and the Companion 5.0.4 host sources. Nothing is taken from README/HELP, which were partly out of
date (see §11).

This is a record of release 1.0.2, kept for reference; it does not describe the module as it is now.
Release 1.1.0 addresses most of the hazards in §5 and the drift in §11, and the open questions in §12
were settled in the Phase 0 review. For the current behaviour see `companion/HELP.md`, `README.md`
and `CHANGELOG.md`.

## 1. Toolchain and build status

| Item | Value | Note |
|---|---|---|
| Node | v22.23.2 (fnm 1.39.0, default) | not on the Git Bash PATH; use `fnm env` or `%APPDATA%\fnm\node-versions\v22.23.2\installation` |
| npm | 10.9.8 | the corepack shim in this Node install is broken (`corepack.js` missing) |
| yarn | 1.22.22 (`yarn.lock` is lockfile v1) | installed into a throwaway folder with `npm install yarn@1.22.22`, nothing global |
| `@companion-module/base` | **1.13.2** (range `^1.6.3`) | `dist/module-api/*.d.ts` is the type authority for this project |
| `@companion-module/tools` | 2.8.0 (range `^2.8.0`) | provides `eslint/config.mjs` (`generateEslintConfig`) and `companion-module-build` |
| typescript | 5.9.3 | `tsconfig.json`: ES2019 / CommonJS / strict / `rootDir src` / `outDir dist` |
| eslint | 8.57.1 (`^8.56.0`) | see below |
| ws | 8.21.0 | |
| `yarn install` | OK (9 s) | one peer warning: `eslint-plugin-prettier` wants `prettier>=3` |
| `yarn build` | **OK** | `rimraf dist && tsc --project tsconfig.json` produces `dist/*.js`, `.d.ts`, `.map` |
| `yarn lint` | **FAILS** | `ESLint couldn't find a configuration file`. The repo has no `.eslintrc*` / `eslint.config.*`. `companion-module-template-ts` ships `eslint.config.mjs` (`generateEslintConfig({ enableTypescript: true })` from `@companion-module/tools`), which needs ESLint 9 + `typescript-eslint` 8 + prettier 3 (peer deps of tools 2.8, not installed here). Fixing lint means adding the config file **and** aligning devDependencies. Deferred to Phase 2 as a separate chore commit. |
| CI | `.github/workflows/companion-module-checks.yaml` → `bitfocus/actions/.github/workflows/module-checks.yaml@main` | Bitfocus module checks on push |

Host on the development machine: Companion **5.0.4**, config in `%APPDATA%\companion`,
`dev_modules_path` set to a local folder, developer mode enabled,
Companion not running at the time of the snapshot.

The store-installed copy `%APPDATA%\companion\modules\disguise-liveupdate-1.0.2` (a copy of the same
files sits in a local folder next to the clone) is a webpack bundle (`main.js`, 175 KB)
whose manifest was rewritten by `companion-module-build` (`runtime.apiVersion: 1.13.2`,
`entrypoint: ../main.js`). Its action / feedback / preset strings match upstream `src/` exactly, so
the source clone is authoritative and that folder is not usable as a work tree.

Runtime declared in the source `companion/manifest.json`: `type: node18`, `api: nodejs-ipc`,
`apiVersion: 1.0.0` (rewritten at package time), `entrypoint: ../dist/index.js`.

## 2. Source layout

| File | Exports | Purpose |
|---|---|---|
| `src/index.ts` | `DisguiseInstance`, `LiveUpdateSubscription`, `DisguiseConfig` (type re-export) | WebSocket client, subscription bookkeeping, variables, `runEntrypoint` |
| `src/config.ts` | `DisguiseConfig`, `getConfigFields()` | connection settings |
| `src/actions.ts` | `getActionDefinitions(instance)`, `DisguiseActionDefinitions` | four "Set to Disguise" actions |
| `src/feedbacks.ts` | `getFeedbackDefinitions(instance)` | `connectionState`, `liveUpdateVariable` |
| `src/variables.ts` | `getVariableDefinitions()` | static `connection_status` only |
| `src/presets.ts` | `getPresetDefinitions(instance)` | 7 presets (see §8) |
| `src/upgrades.ts` | `upgradeScripts: CompanionStaticUpgradeScript<DisguiseConfig>[]` | empty array |

`setActionDefinitions / setFeedbackDefinitions / setVariableDefinitions / setPresetDefinitions` are
all called from the private `applyConfig()`, which runs from both `init()` and `configUpdated()`
(`index.ts:343-358`). `applyConfig` returns early with `InstanceStatus.BadConfig` when `host` is
empty, in which case **no definitions are registered at all**.

## 3. Config (`DisguiseConfig`)

| id | type | label | default | validation |
|---|---|---|---|---|
| `host` | textinput | Director IP Address | `127.0.0.1` | `Regex.HOSTNAME` |
| `port` | number | Port | `80` | 1–65535 |
| `reconnectInterval` | number | Reconnect Interval (ms) | `5000` | 1000–60000, step 1000 |
| `pendingSubscriptionTimeout` | number | Pending Subscription Timeout (ms) | `30000` | 5000–300000, step 5000 |
| `info`, `usageInfo` | static-text | — | — | the usage text still says "Subscribe to Disguise Property" (old feedback name) |

Connection URL: `ws://${host}:${port}/api/session/liveupdate` (`index.ts:365`).

## 4. Actions

All four actions share one shape. **They do not take object/property paths.** They look up an
existing subscription by *variable name* (`getSubscriptionByVariableName`, first match wins) and
send `{ set: [{ id, value }] }` for it. If no `LiveUpdate Variable` feedback with that name has
produced a live subscription, the action logs a warning and does nothing.

| action id | name | option id | type | default | useVariables | value processing |
|---|---|---|---|---|---|---|
| `setToDisguiseString` | Set to Disguise (String) | `variableName` | textinput | `''` | false | — |
| | | `value` | textinput | `''` | true | `parseVariablesInString` → string |
| `setToDisguiseNumber` | Set to Disguise (Number) | `variableName` | textinput | `''` | false | — |
| | | `value` | textinput | `'0'` | true | `parseVariablesInString` → `new Function('return ' + s)()` → must be a finite `number`, otherwise warn + abort |
| `setToDisguiseBoolean` | Set to Disguise (Boolean) | `variableName` | textinput | `''` | false | — |
| | | `value` | checkbox | `true` | — | `Boolean(value)` |
| `setToDisguiseJSON` | Set to Disguise (JSON) | `variableName` | textinput | `''` | false | — |
| | | `value` | textinput | `'{}'` | true | `parseVariablesInString` → `JSON.parse`, error + abort if invalid |

Notes

- Number values are evaluated with `new Function` after variable substitution, so arbitrary JS
  arithmetic works (`$(liveupdate:screen_x)+1`). Non-numeric results are rejected.
- `DisguiseActionDefinitions` declares the four ids explicitly and is exported, so a preset factory
  can `import type` it to type-check `actionId`.
- `setProperty(id, value)` (`index.ts:322`) requires an OPEN socket and a known subscription id.
- There is no toggle-boolean, nudge-number, refresh-subscriptions or unsubscribe action, although a
  log line at `index.ts:604` still refers to a "Refresh Subscriptions" action.

## 5. Feedbacks

### `connectionState` — Connection OK

- `type: 'boolean'`, `options: []`, `defaultStyle: { bgcolor: rgb(0,255,0), color: rgb(0,0,0) }`.
- `callback: () => instance.isConnectionReady()`, true between `ws.open` and `ws.close`.
- Re-evaluated by `checkFeedbacks()` on every `subscriptions` and `valuesChanged` message, not on
  `open`/`close` directly.

### `liveUpdateVariable` — LiveUpdate Variable

- `type: 'advanced'`, returns `{}`: it provides **no styling**, only the subscription side effect.

| option id | type | label | default | constraints | useVariables |
|---|---|---|---|---|---|
| `variableName` | textinput | Variable Name | `my_property` | none in the module | false |
| `objectPath` | textinput | Object Path | `track:track_1` | none | **true** (no effect, see below) |
| `propertyPath` | textinput | Property Path | `object.description` | none | **true** (no effect, see below) |
| `updateFrequency` | number | Update Frequency (ms) | `0` | 0–60000; 0 means no `configuration` is sent | — |

Lifecycle (`feedbacks.ts` + `index.ts`):

- **subscribe**: module-base calls it only when the feedback instance is *inserted*
  (`internal/feedback.js:70-85`). It validates that the three text options are non-empty,
  unsubscribes first if a subscription exists for the same feedback id with different paths, then
  calls `subscribeToVariable(...)`.
- **callback**: runs on every evaluation (insert, any option edit, each `checkFeedbacks()`), and
  calls `checkAndUpdateSubscription(feedback.id, variableName, objectPath, propertyPath, freq)`:
  - the first call caches the options in `feedbackOptionsCache` and subscribes if connected;
  - if `variableName` / `objectPath` / `propertyPath` differ from the cache: unsubscribe + resubscribe
    (**`updateFrequency` is not part of the change detection**);
  - if the options are unchanged but no subscription exists and the socket is ready: resubscribe
    (self-healing, presets added while disconnected).
- **unsubscribe**: drops the cache entry and calls `unsubscribeFromVariable(feedback.id)`.
- `useVariables: true` on the path options has **no effect**. The module reads
  `feedback.options.objectPath` verbatim and never calls `context.parseVariablesInString`, which is a
  no-op inside subscribe/unsubscribe anyway (`internal/feedback.js:53-58`). A path containing
  `$(custom:x)` is sent to the Director literally.

### Subscription bookkeeping (`index.ts`)

- `subscriptions: Map<subId, LiveUpdateSubscription>`: one entry per Director subscription id.
- `feedbackIdToSubscriptionId: Map<feedbackId, subId>`: many feedbacks may point at one id.
- `pendingSubscriptions: Map<"objectPath:propertyPath", { feedbackId, variableName, timestamp }>`:
  matched against the `subscriptions` list the Director sends back; entries older than
  `pendingSubscriptionTimeout` are dropped by a timer.
- **Sharing**: `subscribeToVariable` scans existing subscriptions for an identical
  `objectPath` + `propertyPath` and reuses the id instead of sending a second `subscribe`
  (`index.ts:241-255`). Consequences:
  - the Director's reference count for that id stays at 1 because only one `subscribe` was sent;
  - the shared subscription's `variableName` is **overwritten** with the newest feedback's name, so
    two feedbacks with the same paths but different variable names leave the older variable stale;
  - the frequency of the first subscriber wins; later feedbacks cannot change it;
  - `unsubscribeFromVariable` for *any* one feedback sends `unsubscribe` for the shared id and deletes
    it locally; the other feedbacks re-subscribe on their next `callback` (self-heal), which costs a
    short gap plus one round trip.
- **Set** targets: `getSubscriptionByVariableName` returns the *first* subscription whose
  `variableName` matches, so variable names must be unique per object/property pair.
- **Variable definitions** are rebuilt from the live subscription map on every change
  (`updateVariableDefinitions`, display name `${objectPath}.${propertyPath}`); values are pushed with
  `setVariableValues`. Before the Director confirms, the value is set to `undefined`.

### Message handling (`handleMessage`)

| Director message | Module behaviour |
|---|---|
| `{ error }` | logs; if the text matches `Unable to subscribe to <object> / <property> -`, the pending entry is removed and the variable is set to `'ERROR'`. This format was observed in the field and is **not documented** on the LiveUpdate API page. |
| `{ subscriptions: [...] }` | rebuilds both maps from the authoritative list (pending → live, unknown ids dropped), then `checkFeedbacks()` + `updateVariableDefinitions()` |
| `{ valuesChanged: [...] }` | value objects shaped `{ errorType, message }` count as property-path errors: the variable becomes `'PATH_ERROR'`, and after **3 consecutive** errors the module sends `unsubscribe`, deletes the subscription and sets `'PATH_ERROR (unsubscribed)'`. Otherwise numbers / strings / booleans are stored as-is and objects / arrays as `JSON.stringify` text; then `checkFeedbacks()`. The `errorType` shape is also undocumented upstream. |

### Behavioural hazards relevant to presets

1. **Subscribe storm on bad paths.** After an `error` or the 3-strike unsubscribe, the feedback's
   options are unchanged, so the very next `callback` (triggered by *any* `valuesChanged` from any
   other subscription) re-subscribes immediately, fails again, and repeats. With one healthy 100 ms
   subscription on the same connection, a broken feedback retries about 10 times per second. Presets
   shipped with unreplaced placeholders such as `<TRACK_NAME>` would hit exactly this. Phase 2 needs a
   guard (skip subscribe while the path still contains `<…>`, or exponential back-off after errors).
2. **Whitespace-sensitive matching.** Pending entries are matched on the exact
   `objectPath:propertyPath` string echoed by the Director. If the Director ever normalises the
   strings, the subscription is orphaned locally and leaks on the Director until the socket closes.
3. **`variableName` is used unsanitised** as a Companion `variableId`. Companion's documented rule is
   letters, digits, underscore and hyphen only
   (`companion.free/for-developers/module-development/connection-basics/variables`). Nothing in the
   module enforces it. The Companion 5.0.4 host defines a variable only when its id matches
   `/^([a-zA-Z0-9-_.]+)$/`, so it accepts `.` as well, and lists any other id as invalid in its log.
4. On `close` the module clears all maps; the Director drops subscriptions with the socket, so there
   is no leak across reconnects. On reconnect `subscribeFeedbacks()` re-runs `subscribe` for every
   feedback.
5. Dead or inconsistent code: `formatValue()` is unused; `Regex` and `CompanionActionContext` are
   imported but unused in `index.ts`; the comment in `variables.ts` still describes a `sub_<id>`
   naming scheme that no longer exists.

## 6. Variables

| variableId | name | source |
|---|---|---|
| `connection_status` | Connection Status | `'Connected'` on open, `'Disconnected'` on close |
| `<variableName>` (dynamic) | `<objectPath>.<propertyPath>` | one per live subscription; primitive values keep their JS type, objects / arrays become JSON strings |

## 7. Upgrade scripts

None (`upgradeScripts = []`). Any future change to option ids needs a `CompanionStaticUpgradeScript`.

## 8. Existing presets (`src/presets.ts`)

| preset id | category | name | textExpression | feedback paths (variableName) | actions |
|---|---|---|---|---|---|
| `trackLengthMonitor` | Track Monitoring | Track Length Monitor | yes | `track:track_1` / `object.lengthInBeats` (`track_length`), freq 0 | — |
| `screenNameMonitor` | Screen Monitoring | Screen Name Monitor | no | `screen2:surface_1` / `object.mesh.description` (`screen_name`), freq 0 | — |
| `fpsMonitor` | Performance Monitoring | FPS Monitor | yes | `subsystem:MonitoringManager.findLocalMonitor("fps")` / `object.seriesAverage("Actual", 1)` (`fps`), 1000 ms | — |
| `playheadMonitor` | Transport | Playhead Readout | yes | `transportManager:default` / `object.player.tRender` (`playhead`), 100 ms | — |
| `screenOffsetMonitor` | Screen Control | Screen Offset Monitor | yes | `screen2:surface_1` / `object.offset.x` (`screen_x`), freq 0 | — |
| `screenOffsetSetPlus` | Screen Control | Screen X +1 | no | same as above | `setToDisguiseNumber` `screen_x` = `$(liveupdate:screen_x)+1` |
| `screenOffsetSetMinus` | Screen Control | Screen X -1 | no | same as above | `setToDisguiseNumber` `screen_x` = `$(liveupdate:screen_x)-1` |

Every preset also carries `connectionState` with a green style. Verification status of the paths
after the Phase 0 research (see `docs/PHASE0_CANDIDATES.md`): `track:… / object.lengthInBeats`,
`screen2:… / object.description` and the fps monitor appear verbatim on the LiveUpdate API page;
`transportManager:default` / `object.player.tRender` is shown verbatim in disguise's plugin
getting-started guide (`autoSubscribe('transportManager:default', ['object.player.tRender'])`) and
`transportmanager:default` on the help-site expressions page, so it is doc-verified apart from the
prefix casing; `object.mesh.description` and `object.offset.x` (read) are pyi-backed on a documented
prefix; a **set** through the scalar `object.offset.x` is undocumented (the documented form is a
partial JSON set on `object.offset`). All existing presets except the fps one use
`updateFrequency: 0`, which the monitoring guide's 60 Hz push rate argues against.

## 9. Companion host facts that constrain the preset design (Companion 5.0.4, module-base 1.13.2)

- Preset types: `CompanionButtonPresetDefinition` (`type: 'button'`, `category`, `name`, `style`,
  `previewStyle?`, `options?: { relativeDelay, stepAutoProgress, rotaryActions }`, `feedbacks`,
  `steps[]` with `down / up / rotate_left / rotate_right / <delay>`) and
  `CompanionTextPresetDefinition` (`type: 'text'`, `category`, `name`, `text`)
  (`dist/module-api/preset.d.ts`).
- `CompanionButtonStyleProps`: `text`, `textExpression?`, `size` (`'auto' | '7' | '14' | '18' | '24' |
  '30' | '44' | number`), `color`, `bgcolor`, `alignment?`, `pngalignment?`, `png64?`, `show_topbar?`.
  `textExpression: true` is honoured by the host (`Thread/PresetUtils.ts:117-127` spreads the raw
  style over a default of `false`).
- Preset feedback entries: `{ feedbackId, options, style?, isInverted?, headline? }`. `style` only
  matters for boolean feedbacks (it becomes a style override). Options are stored as plain values
  (`optionsObjectToExpressionOptions(options, true)`), so a 1.x module cannot ship an option in
  expression mode.
- **Category order in the UI is alphabetical**: `PresetsLegacy.ts:61` sorts the distinct category
  names with `.sort()`. Presets inside a category keep definition order. A `type: 'text'` preset
  starts a new named group (its `text` becomes the group description) that collects the button
  presets following it in the same category. Category names must not be in `BANNED_PROPS`.
- Preset references (linked presets), sections and template groups
  (`CompanionPresetGroupTemplate` with `templateVariableName` / `templateValues`) exist only in
  module-base 2.x (`dist/module-api/preset/structure.d.ts` of 2.1.3, Node `^22.20`). 1.x presets
  are always placed as copies. Moving to base 2.x would be a separate, larger migration.
- Companion parses `$(label:name)` in button text; the documented `variableId` charset is
  `[A-Za-z0-9_-]`.
- `setPresetDefinitions` is a plain synchronous call that can be made at any time; the current code
  calls it once per `applyConfig`.

## 10. LiveUpdate protocol as used by the module vs. the API page

| Feature | API page | Module |
|---|---|---|
| `subscribe { object, properties[], configuration.updateFrequencyMs }` | yes | one property per message; `configuration` only when freq > 0 |
| `unsubscribe { id }` / `{ ids[] }` | yes | single `id` form only |
| `set [{ id, value }]` with partial merge for JSON objects | yes | reachable through the JSON action |
| `subscriptions[]` full list after each change | yes | used as the source of truth |
| `valuesChanged[]` with `changeTimestamp` / `messageTimestamp` | yes | stored on the subscription, not exposed |
| `{ error }` | yes (free text) | parsed with a regex for pending clean-up |
| Reference counting of identical subscriptions | yes (per client, per property) | avoided client-side by reusing ids |
| Resource serialisation `{ uid, path, type }` | yes | arrives as a JSON string in the variable |

## 11. Documentation drift (README / HELP vs code)

- README, HELP and the config "How to Use" text say the Set actions take *Value + Object Path +
  Property Path*; the code takes *Variable Name + Value* and needs a feedback first.
- HELP still refers to a "Subscribe to Disguise Property" feedback (now "LiveUpdate Variable").
- HELP's example table includes `ledscreen:myledscreen`, a prefix that appears on no official page
  (`screen2:` and `projector:` do), and its Boolean example `track:track_1` / `object.enabled`
  refers to a member that does not exist on `Track`/`SuperTrack` in `d3.pyi` r34.0 (`enabled` is a
  `SuperLayer` property, r33.1+).
- HELP's screen examples use `screen2:surface_1` while the LiveUpdate page uses `screen2:screen_1`.
- `companion/manifest.json` carries `runtime.apiVersion: 1.0.0`; the companion.free manifest docs say
  it should be left at `0.0.0` so the build populates it (the store build shows `1.13.2`).

## 12. Open questions for the reviewer

1. Work tree: the local `disguise-liveupdate` folder is the packaged store copy (no `src/`, no
   git). Phase 0 was done on a fresh clone of this repository. Confirm this clone (or a fork of it)
   is the intended work branch for Phases 2–4.
2. `yarn lint` fails upstream as-is (no ESLint config). Is adding `eslint.config.mjs` plus the
   devDependency alignment acceptable as a separate chore commit in Phase 2?
3. Director `192.0.2.10:80`: ping and TCP connect both fail from this machine right now (local
   interfaces include `192.0.2.20` on the control network). Live verification needs the Director
   online and an explicit go-ahead for read-only subscriptions and for any write-test objects.
4. The subscribe-storm hazard (§5, item 1) makes placeholder presets risky without a small module
   guard. Is a minimal, backward-compatible guard (skip subscribe while a path contains `<…>`, back
   off after errors) acceptable as the one allowed module extension?
