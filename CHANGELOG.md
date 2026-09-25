# Changelog

## 1.1.0 (unreleased)

### Added

- Preset library: 310 presets in 11 categories (connection, local and remote monitoring, transport
  state, track and layer inspection, layer control, stage and screen, expression variables,
  RenderStream, failover/d3Net, templates) generated from `docs/research/phase1-catalog.json`, where
  every row is traced to a documented Designer API member and rendered to `docs/PRESET_CATALOG.md`.
  25 read-only experimental presets (`99 Experimental`) are available behind the new *Show
  experimental presets* setting. Layer scale has presets for both axes (`Layer scale.y`,
  `Scale Y +0.1 / -0.1 / = 1`).
- Preset feedback paths carry the connection's own label, so a second connection (`liveupdate_2`) or a
  renamed one follows its own selections. Companion 5.0.4 relabels a preset's text, style overrides and
  action options itself but not its feedback options.
- Selection variables (`selTrack`, `selScreen`, `selMachine`, ...) with a *Selections* block in the
  connection settings and a *Set selection* action; the presets address show objects through them
  and re-subscribe when a selection changes. Values are validated for the slot they fill (names
  without quotes or line breaks, plain decimal indices, decimal or `0x` hex ids); an empty selection
  is published as `$NA`, and a value that parses to `$NA` or an unresolved reference clears it.
- Selection lists read from the Director: one action per selection ('Set selection: Track', 'Set
  selection: Surface (screen2)', ...) whose value is a dropdown of the names Designer actually has, so
  a mistyped name can no longer be the reason a preset shows PATH_ERROR. The lists are read once per
  connection (*Read selection lists on connect*, on by default) and on demand with the 'Refresh
  selection lists' action; a name can still be typed. Any answer from the Director replaces a list,
  even an empty one; a failed read keeps the previous list. A 'Set selection profile' action applies
  several selections with one press, so a button re-points a whole page at another part of the show.
- *LiveUpdate Compare* boolean feedback (state colours for any LiveUpdate Variable). A value that is
  unknown (none yet, `null`, a Director error or one of the readout markers, also when the Director
  sends that text itself) satisfies no comparison, including *not equal* and *is true*.
- *Toggle Disguise Boolean* action.
- *Nudge Disguise Number* action: adds a step to the current value of a numeric property in the
  module, keeps the result within an optional minimum and maximum, and writes nothing while the
  property has no number. The detents of a rotary encoder add up, also before the Director has
  reported the previous write. The nudge and knob presets use it; brightness, volume and the master
  fades stay within their documented 0..1.
- *LiveUpdate Sparkline* feedback: draws the recent values of a LiveUpdate Variable as a line on the
  button, so a frame rate or a latency shows its trend and not only its current number. The module
  renders the pixels itself, with no drawing dependency. Options: samples to keep (4..300, default 60,
  per feedback), automatic or fixed scale, line colour, fill and a threshold rule such as a frame
  budget. A value the readout loses (OFFLINE, PENDING, ERROR, PATH_ERROR, UNSET or anything that is
  not a number) is drawn as a break, never joined across; a readout moved to another object or removed
  starts a new line. On Companion 5 the line goes into an Image layer: buttons placed from the presets
  have one, a button created by hand needs one added before the feedback (see HELP, *Seeing a trend*).
- Command actions over Designer's Session REST API, on the same host and port. **Transport:** play,
  stop, play to end of section, loop section, return to start, next and previous section and track, go
  to section (by number), note, tag, track, timecode and time, brightness, volume, speed and engaged.
  **RenderStream:** start, stop, restart and sync layers. **Failover:** fail over machine, restore
  machine, apply default routing. LiveUpdate cannot carry commands, so the OSC module is no longer
  needed for the common cases. Every path and body comes from the Director's own OpenAPI document
  (`scripts/rest-discover.mjs` reads it back).
  - Commands are enabled by default. Transport commands fire on one press, *Stop*, brightness 0 and
    volume 0 included. Only the RenderStream and Failover commands, which change the shape of the
    session, are refused unless *Allow destructive commands* is on, and then need two presses of the
    same button within *Confirm within (s)*, with the arm bound to the button and the resolved target.
    Arms are cleared when either setting is turned off or the host or port changes.
  - *Command armed* lights only on the button that was pressed; `rest_armed` names the most recent arm
    still waiting. `rest_last_command`, `rest_last_status` (`OK` / `FAILED` / `UNSUPPORTED`) and
    `rest_last_message` report the last command sent, and *Last command failed* colours a button. A
    press refused before sending is only logged.
  - *Go to section*, *note*, *tag*, *track* and *timecode* and next / previous section and track have
    a *Play mode after the jump* option (default *Leave unchanged*, sent as `NotSet`); *Go to time*
    does not. The four next / previous actions send the body the OpenAPI document records for them,
    and a button saved without the option leaves the play state as it is.
  - Object references are a name or, with 6 or more digits, a uid; `name:` or `uid:` chooses
    explicitly (`name:20250914` for a date-stamped track).
  - A free-text parameter that is empty, contains `$NA` or an unparsed `$(...)`, or is exactly one of
    the readout words (`PENDING`, `UNSET`, `OFFLINE`, ...) refuses the command with one warning; an
    empty number field is never sent as 0, and a RenderStream layer list is sent only when every entry
    resolves.
  - A command the Director answers 404 or 405 for is reported `UNSUPPORTED` and not sent again;
    *Command: rescan the command API* forgets that, for example after a Designer upgrade. A reply that
    stalls or breaks after its headers counts as a failure.
- *Check presets against this Director* action: subscribes once to every preset property whose
  selections are filled in, records whether the Director answered with a value and releases it again,
  then reports the counts in the selfcheck_* variables. Every count is of distinct properties;
  `selfcheck_skipped` counts the ones whose selection is empty. A property a placed button holds is
  read from that button. It answers "which of these presets work on this Designer and this show file"
  without touching the subscriptions the buttons already hold.
- `designer_version`: the Designer version of the connected Director, read on every connection. The
  log says so when the major version differs from r34, the one the catalog was verified on.
- Readout markers. Besides `ERROR`, `PATH_ERROR` and `PATH_ERROR (unsubscribed)`, which 1.0.2 already
  wrote, a readout can show `OFFLINE` (no connection), the new `UNSET`: the path cannot be resolved
  yet (an empty selection or `$NA`, an unparsed `$(...)`, an empty object or property path, a bare
  empty name such as `track:""`, a template placeholder), and the new `PENDING`: requested from the
  Director, no value yet, so a readout that waits for its answer (just placed, after a reconnect,
  during a retry) is never mistaken for a value the Director sends empty. The preset texts show these
  words as they are, without formatting or unit. The list is exported as `SENTINELS`.
- Connection settings for the default preset update intervals (monitoring, playhead, state, static).
- Guard against paths that cannot be resolved: an empty path, a template placeholder, `$NA` or a raw
  `$(...)` reference, and for object paths a bare empty name (`track:""`) or a remote-monitor node
  without a host (`":d3"`) are never sent. A refusal is logged once per feedback. Failed subscriptions
  back off exponentially (2 s doubling up to 60 s) on their own timer instead of retrying on every
  value update.
- `scripts/gen-presets.mjs`, `scripts/gen-help.mjs` and `scripts/render-catalog.mjs` regenerate the
  preset table, the HELP preset list and the rendered catalog from the catalog JSON.
  `scripts/gen-presets.mjs` refuses a button text that would hide a readout marker or an undefined
  value, show an empty value (a Director `''` or `None`) as anything but empty, or render NaN,
  checked with `scripts/companion-expression.cjs`, which renders a text with Companion 5.0.4's
  expression semantics.
- `scripts/build-dev-module.mjs` builds a self-contained folder for Companion's Developer modules
  path, with an optional custom label and a semver version (default: the package version). It only
  ever deletes its own earlier build.
- Test suite (`yarn test`, node:test + tsx): path-guard unit tests, catalog-to-implementation
  consistency, subscription lifecycle against an in-process fake Director (shared subscriptions,
  back-off, error strikes, config updates, selections, outages), the command channel against a mock
  REST API, the sparkline, the script guards and an end-to-end run over a real WebSocket mock Director
  (subscribe, set, toggle, JSON merge, reconnect).
- Scripts that talk to a real Director, none of them part of `yarn test`: `scripts/live-verify.mjs`
  (read-only verification of every catalog pair), `scripts/rest-discover.mjs` (read-only, the
  Director's OpenAPI document), `scripts/live-write-verify.mjs` and `scripts/rest-command-verify.mjs`
  (dry run without `--yes`). Their raw output goes to the git-ignored `.live/` folder, because it holds
  site data; writing into `docs/research` needs an explicit `--out` and a scrub. Exit codes: 0 clean,
  1 a failure or something not restored or not confirmed, 2 when a guard refused before writing;
  `rest-command-verify.mjs` exits 1 without sending anything when the transport or the playhead cannot
  be read, `--force` or not.
  - `live-write-verify.mjs` reads the current value, writes a small change, writes the original back
    and re-reads everything; a restore that fails stops the run, and an interrupt or a connection the
    Director closes restores the value in flight or prints `SET THIS BACK BY HAND`. The `neutral`
    group only touches a track that is not the transport's current one and the `output` group refuses
    to run while the transport plays. Both guards fail closed (a state that cannot be read refuses the
    run) and `--force` overrides them.
  - `rest-command-verify.mjs` reads the state, sends each command, reads the result back and puts it
    back. The value, time and play / stop steps fail when the effect does not show; the section, note
    and next / previous track jumps and RenderStream sync layers record what the Director showed and
    pass once accepted. It needs a stopped transport unless `--force` is given, never sends a
    failover command, and a final sweep reports anything it could not put back.
- Live verification on Designer r34.0.3 (2026-09-04, two read-only passes): 280 of the 310
  default presets confirmed with a value; every catalog row carries its live result
  (`docs/PRESET_CATALOG.md`, column *live*). 103 experimental presets that returned a value
  were promoted to their home categories (ids and variable names unchanged); `selLedScreen`,
  `selStageUid` and `selRsLayer` are regular selections now.
- Write verification on the same Director: 22 properties written and restored through the protocol
  (groups `neutral`, which touches only a track that is not on air, and `output`) and three through
  the module's own actions (`test/live-write.e2e.ts`: Set Number with an expression, Toggle Boolean,
  Set JSON with a partial object). Every value came back to its original; the results are in
  `docs/research/live-write-*.json` and in the *write* column of `docs/PRESET_CATALOG.md`.
- Command verification on the same Director (`docs/research/rest-verification.json`): play, stop,
  play to end of section, loop section, return to start, next and previous section, go to section,
  go to note, go to timecode, go to time, brightness, volume and engaged were sent, checked and put
  back. Next track, previous track and go to track were accepted but could not change the track,
  because the test project's set list had one track. RenderStream sync layers was accepted. Set speed
  was refused because Designer's *enableTransportSpeedControl* was off, and go to tag was not sent.
  The jumps were sent with the script's own body (play mode `Stop`); the next and previous section
  and track steps have not been sent with the body the module sends now.

### Changed

- A LiveUpdate Variable name is checked against the characters Companion itself accepts in a variable
  id: letters, digits, `_`, `-` and `.`, a leading digit included, no length limit, so every name
  Companion could define in 1.0.2 keeps working. A name with any other character (a space, for
  example), which Companion refuses to define and reports as an invalid id in its log, is no longer
  subscribed; the module logs that once. Rename such a feedback and every `$(liveupdate:...)`
  reference to it. Property paths are sent as written, so valid Python such as `""`, `[]` or `(1,)` in
  a property path reaches the Director as before. The module's own variable names
  (`connection_status`, `designer_version`, the `selfcheck_*` and `rest_*` variables and every
  selection id) are reserved: a feedback that uses one is not subscribed, and the log says so once.
- When the connection drops, every readout owned by a LiveUpdate Variable feedback shows `OFFLINE`
  instead of the last value it had; 1.0.2 kept the stale value. Selections and the module's own
  variables are left alone. After a reconnect each readout says `PENDING` until its value arrives or
  shows `UNSET`, and saving the settings while the Director is away keeps `OFFLINE`; a feedback placed
  or renamed while the Director is away shows it too. On disconnect and reconnect the module
  re-checks Connection OK, LiveUpdate Compare, LiveUpdate Sparkline, Command armed and Last command
  failed, so no state colour outlives the connection.
- Clearing a selection or emptying a path makes the readout show `UNSET` instead of the previous
  object's value, unless another feedback still feeds the same variable name.
- Shared subscriptions: identical object/property pairs share one Director subscription, requests are
  de-duplicated while in flight and the subscription is released only when the last button using it
  goes away. It runs at the fastest update interval any placed feedback asks for, `0` (as fast as
  possible) beating any number, and a faster feedback that joins later re-subscribes it at that rate.
  Editing a feedback's Update Frequency re-subscribes with the new interval.
- Subscribe requests that arrive together (connection start, reconnect, a page of presets placed at
  once, a selection change) leave as one frame per object and update interval instead of one per
  property. The transport presets at the default intervals go out in four frames (playhead, state and
  static on `transportManager:default`, plus the GUI playhead). The Director still holds one
  subscription per property.
- Variable definitions are sent to Companion only when they change, and a Director confirmation
  re-runs only the feedbacks it concerns (1.0.2 re-ran every feedback on every subscriptions reply and every value update); with
  30 feedbacks placed at once that is at most three callback runs per feedback. A reconnect sends no
  definition push.
- A burst of writes to the same property is collapsed: the first goes out at once so a single
  press stays instant, and a fast rotary spin becomes one write per 40 ms window carrying the value
  the operator stopped on, instead of one write per detent.
- Config updates that only touch presets or selections keep the WebSocket connection.
- Every variable owned by a placed LiveUpdate Variable feedback is defined as soon as the feedback is
  placed and stays defined, so an error marker that arrives before the connection is ready still
  reaches the button.
- A Director error that names a pair fails only that pair. An error that names none is attributed only
  when exactly one request is in flight. Changing a path while its request is in flight subscribes the
  new path, and the old path's failure is not shown.
- The layer scale presets use `findSequence("scale.x")`: the plain name `scale` returns None on
  r34.0.3 for every layer type tested, and the second axis got its own presets.
- Catalog corrections from the live run: the "(by index)" layer presets use `track.layers[i]` (the
  documented `getLeafLayers()[i]` object path is rejected by r34.0.3), the RenderStream layer-route
  presets evaluate `getLeafLayers(RenderStreamModule)[i]` inside the property expression (class names
  do not resolve in object paths) and the workload id preset returns the 64-bit id as text, timecode
  and Director-understudy presets show an empty string instead of an error while the transport has
  no timecode source or no understudy is assigned. Two experimental machine-health presets were
  removed (`fo_health_worst`, `fo_health_states`: API conversion error on r34.0.3).
- The live-verification evidence carries no identity of the rig it was recorded on. Resource uids use
  the placeholder family `0x0123456789abcdeX` (the d3net.apx uid is `0x0123456789abcde2`), the
  workload ids `1000000000000000001` to `1000000000000000003` (`1000000000000000000` where a value
  is rounded), and addresses RFC 5737 documentation addresses. Designer's own error texts, class
  names, status words, version strings, machine type and monitor names are kept. Per-camera monitor
  names, layer, cue and section lists, timecode positions, graph samples, network adaptors and project
  and session names are redacted. The write runs' track list reads demo / track 1 / track 2 /
  Show Track.
- HELP rewritten: commands, selections, readout markers, preset list, OSC-module pairing, object path
  reference, limits.
- Tooling aligned with the Bitfocus module template: ESLint 9 flat config, prettier, TypeScript
  strict lint; `@companion-module/base` pinned to `~1.13.2`; manifest `apiVersion` left at `0.0.0`
  for the packager to fill in.

### Fixed

- A broken path no longer causes a subscribe storm: 1.0.2 re-subscribed on every value update of any
  other subscription; failed subscriptions now back off.
- Removing one of several feedbacks that share a property no longer drops the subscription of the
  others, and a shared subscription keeps the variable name of the feedback that created it (1.0.2
  overwrote it, which froze the first feedback's variable and broke its actions).
- One variable name can no longer be bound to two different properties: the Set and Toggle actions
  find their subscription by name, so the second button wrote to the first button's property. The
  second subscription is refused with a log message.
- Set to Disguise (Number) sends only finite numbers (Infinity reached the Director as `null`).
- A step written as a Number expression, such as `$(liveupdate:brightness)-0.05` on a 1.0.2 button,
  is no longer written as an absolute value. Companion substitutes the readout before the action runs,
  so while the readout was empty the module received `-0.05` and sent it. A Number value that starts
  with an operator is now refused while the property has no numeric value, and the presets nudge with
  *Nudge Disguise Number*, which adds the step to the value the Director sent.
- Set to Disguise (JSON) forwards a deliberate JSON `null` and drops only genuine parse failures.
- The Connection OK feedback refreshes on connect and disconnect.
- A subscription the Director reports that no feedback owns is released instead of forgotten.
- Closing a socket that is still connecting (connection restart or module shutdown while the
  Director is slow to answer) no longer crashes the module process.
- README and HELP described the *Set to Disguise* actions with object/property path options; the
  actions take a Variable Name and a Value and write through the feedback's subscription.
- The `ws` message payload is decoded explicitly instead of relying on `toString()`.

## 1.0.2 and earlier

See the git history.
