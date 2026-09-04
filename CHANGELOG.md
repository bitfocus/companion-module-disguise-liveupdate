# Changelog

## 1.1.0 (unreleased)

### Added

- *LiveUpdate Sparkline* feedback: draws the recent values of a LiveUpdate Variable as a line on
  the button, so a frame rate or a latency shows its trend and not only its current number. The
  module renders the pixels itself, with no drawing dependency; the history is bounded and kept only
  while a sparkline asks for it. Options: window length, automatic or fixed scale, line colour,
  fill, and a threshold rule such as a frame budget.
- Selection lists read from the Director: one action per selection ('Set selection: Track', 'Set
  selection: Surface', ...) whose value is a dropdown of the names Designer actually has, so a
  mistyped name can no longer be the reason a preset shows PATH_ERROR. The lists are read once per
  connection (a setting turns that off) and on demand with the 'Refresh selection lists' action; a
  name can still be typed by hand. A 'Set selection profile' action applies several selections with
  one press, so a button re-points a whole page at another part of the show.
- Command actions over Designer's Session REST API: transport play / stop / play section / loop
  section / return to start / next and previous section and track / go to section, track, timecode
  and time / brightness / volume / speed / engaged, RenderStream layer start, stop, restart and sync,
  and failover machine, restore machine and apply default routing. LiveUpdate cannot carry commands,
  so this replaces the OSC module for the common cases. Every path and body comes from the
  Director's own OpenAPI document (`scripts/rest-discover.mjs` reads it back). Commands are enabled
  by default; the ones that change what the audience sees or the shape of the session are refused
  unless *Allow destructive commands* is on and then need two presses of the same button, with the
  arm bound to the resolved target. Variables report the last command, its result and what is armed,
  and two feedbacks colour the button.
- Preset library: 310 presets in 11 categories (connection, local and remote monitoring, transport
  state, track and layer inspection, layer control, stage and screen, expression variables,
  RenderStream, failover/d3Net, templates) generated from `docs/research/phase1-catalog.json`, where
  every row is traced to a documented Designer API member and rendered to `docs/PRESET_CATALOG.md`. 25 read-only experimental presets
  (`99 Experimental`) are available behind the new *Show experimental presets* setting.
- Selection variables (`selTrack`, `selScreen`, `selMachine`, ...) with a *Selections* block in the
  connection settings and a *Set selection* action; the presets address show objects through them
  and re-subscribe when a selection changes.
- *LiveUpdate Compare* boolean feedback (state colours for any LiveUpdate Variable).
- *Toggle Disguise Boolean* action.
- Connection settings for the default preset update intervals (monitoring, playhead, state, static).
- Guard against unresolved object paths (template placeholders, `$NA`, empty names or argument
  slots) and an exponential back-off after failed subscriptions (2 s doubling up to 60 s, with a
  timer that retries on its own) instead of retrying on every value update.
- Selection values are validated for the slot they fill (names without quotes or line breaks,
  plain decimal indices, decimal or `0x` hex ids); unset selections publish `$NA` so presets stay
  quiet until they are filled in. `sel...` and `connection_status` are reserved variable names.
- Subscribe requests are de-duplicated while in flight and shared subscriptions are reference
  counted, so placing many presets or changing a selection sends one request per property and the
  Director subscription is released only when the last button using it goes away.
- Every variable owned by a placed LiveUpdate Variable feedback stays defined, so `ERROR` and
  `PATH_ERROR` indicators reach the button; the Connection OK feedback refreshes on connect and
  disconnect; editing a feedback's Update Frequency re-subscribes with the new interval.
- `scripts/gen-presets.mjs` and `scripts/gen-help.mjs` to regenerate the preset table and the HELP
  preset list from the catalog JSON.
- Test suite (`yarn test`, node:test + tsx): path-guard unit tests, catalog-to-implementation
  consistency, subscription lifecycle against an in-process fake Director (shared subscriptions,
  back-off, error strikes, config updates, selections) and an end-to-end run over a real WebSocket
  mock Director (subscribe, set, toggle, JSON merge, reconnect).
- `scripts/live-verify.mjs`: read-only live verification of every catalog pair against a Director;
  results and follow-up probes are kept in `docs/research/live-verification*.json`.
- Live verification on Designer r34.0.3 (2026-09-04, two read-only passes): 280 of the 310
  default presets confirmed with a value; every catalog row carries its live result
  (`docs/PRESET_CATALOG.md`, column *live*). 103 experimental presets that returned a value
  were promoted to their home categories (ids and variable names unchanged); `selLedScreen`,
  `selStageUid` and `selRsLayer` are regular selections now.
- `scripts/live-write-verify.mjs`: write verification that reads the current value, writes a small
  change, writes the original back and re-reads everything; a restore that fails stops the run and an
  interrupt restores the value in flight before exiting.
- Write verification on the same Director: 22 properties written and restored through the protocol
  (groups `neutral`, which touches only a track that is not on air, and `output`) and three through the module's own
  actions (`test/live-write.e2e.ts`: Set Number with an expression, Toggle Boolean, Set JSON with a
  partial object). Every value came back to its original; the results are in
  `docs/research/live-write-*.json` and in the *write* column of `docs/PRESET_CATALOG.md`.
- Layer scale presets for the second axis (`Layer scale.y`, `Scale Y +0.1 / -0.1 / = 1`).
- `scripts/live-write-verify.mjs`: write verification with read-before, restore-after and a final
  read-back; an interrupt restores the value in flight before exiting.

### Changed

- The live-verification evidence carries no identity of the rig it was recorded on: the project,
  track, layer, screen, cue and machine names the Director returned are replaced by neutral
  placeholders, addresses by RFC 5737 documentation addresses, and any value that is not part of
  Designer's own vocabulary is redacted.

- Config updates that only touch presets or selections keep the WebSocket connection.
- The layer scale presets use `findSequence("scale.x")`: the plain name `scale` returns None on
  r34.0.3 for every layer type tested, and the second axis got its own presets.
- Catalog corrections from the live run: the "(by index)" layer presets use `track.layers[i]` (the
  documented `getLeafLayers()[i]` object path is rejected by r34.0.3), the RenderStream layer-route
  presets evaluate `getLeafLayers(RenderStreamModule)[i]` inside the property expression (class names
  do not resolve in object paths) and the workload id preset returns the 64-bit id as text, timecode
  and Director-understudy presets show an empty string instead of an error while the transport has
  no timecode source or no understudy is assigned. Two experimental machine-health presets were
  removed (`fo_health_worst`, `fo_health_states`: API conversion error on r34.0.3).
- Closing a socket that is still connecting (connection restart or module shutdown while the
  Director is slow to answer) no longer crashes the module process.
- Variables owned by a placed LiveUpdate Variable feedback are defined as soon as the feedback is
  cached, so an `ERROR` answer that arrives before the connection is ready still reaches the button.
- HELP rewritten: selections, preset list, OSC-module pairing, object path reference, limits.
- Tooling aligned with the Bitfocus module template: ESLint 9 flat config, prettier, TypeScript
  strict lint; `@companion-module/base` pinned to `~1.13.2`; manifest `apiVersion` left at `0.0.0`
  for the packager to fill in.

### Fixed

- README and HELP described the *Set to Disguise* actions with object/property path options; the
  actions take a Variable Name and a Value and write through the feedback's subscription.
- The `ws` message payload is decoded explicitly instead of relying on `toString()`.

## 1.0.2 and earlier

See the git history.
