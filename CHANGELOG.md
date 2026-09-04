# Changelog

## 1.1.0 (unreleased)

### Added

- Preset library: 203 presets in 11 categories (connection, local and remote monitoring, transport
  state, track and layer inspection, layer control, stage and screen, expression variables,
  RenderStream, failover/d3Net, templates) generated from `docs/PRESET_CATALOG.md`, where every row
  is traced to a documented Designer API member. 128 read-only experimental presets
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
- Live verification on Designer r34.0.3 (2026-09-04): 164 default and 94 experimental presets
  confirmed with a value; every catalog row carries its live result (`docs/PRESET_CATALOG.md`,
  column *live*).

### Changed

- Config updates that only touch presets or selections keep the WebSocket connection.
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
