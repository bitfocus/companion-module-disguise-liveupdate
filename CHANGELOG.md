# Changelog

## 1.1.0 (unreleased)

### Added

- Preset library: 203 presets in 11 categories (connection, local and remote monitoring, transport
  state, track and layer inspection, layer control, stage and screen, expression variables,
  RenderStream, failover/d3Net, templates) generated from `docs/PRESET_CATALOG.md`, where every row
  is traced to a documented Designer API member. 130 read-only experimental presets
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

### Changed

- Config updates that only touch presets or selections keep the WebSocket connection.
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
