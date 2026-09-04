# companion-module-disguise-liveupdate

Bitfocus Companion module for the disguise Designer **LiveUpdate API**.

## Description

The module connects to the WebSocket LiveUpdate API of a Designer Director and lets you:

- Monitor any Designer property in real time through **feedbacks** that create live Companion
  variables (`$(liveupdate:fps)`, `$(liveupdate:playheadBeats)`, ...)
- Set property values (strings, numbers, booleans, JSON objects) and toggle booleans
- Colour buttons from a value with the **LiveUpdate Compare** feedback
- Drop ready-made buttons from a **preset library** of 310 presets (monitoring, transport state,
  track and layer, layer control, stage and screen, expression variables, RenderStream,
  failover) plus 25 experimental presets; the presets address the show through **selection
  variables** (`selTrack`, `selScreen`, `selMachine`, ...) set once in the connection settings
- Recover automatically from connection loss and subscription errors

LiveUpdate does not carry transport commands (play, stop, cue); pair this module with
[companion-module-disguise-osc](https://github.com/bitfocus/companion-module-disguise-osc) for those.

See [companion/HELP.md](companion/HELP.md) for the user documentation and
[docs/PRESET_CATALOG.md](docs/PRESET_CATALOG.md) for the source of every preset.

## Supported Devices

- disguise Designer with the LiveUpdate API (documented paths verified against the r34 API stubs, read- and write-checked live on r34.0.3)
- Companion 4.1 or newer (module API 1.13)

## Configuration

- **Director IP Address / Port**: the Designer Director (default 127.0.0.1:80)
- **Reconnect Interval / Pending Subscription Timeout**: connection housekeeping
- **Preset settings**: show experimental presets; default update intervals per value class
- **Selections**: the object names the presets use (track, layer, surface, projector, machine, ...)

## Feedbacks

- **LiveUpdate Variable**: subscribes to an object path / property path and exposes the value as a variable
- **LiveUpdate Compare**: boolean comparison of a LiveUpdate Variable (=, ≠, <, ≤, >, ≥, truthy, contains)
- **Connection OK**: true while connected

## Actions

- **Set to Disguise (String / Number / Boolean / JSON)**: write a value through the subscription of a LiveUpdate Variable
- **Toggle Disguise Boolean**: flip a boolean property
- **Set selection**: change a selection variable (and therefore every preset built on it)

## Variables

- `connection_status`: `Connected` / `Disconnected`
- `sel...`: selection variables
- one variable per LiveUpdate Variable feedback

## Development

```bash
yarn install
yarn build              # tsc, emits dist/ from src/
yarn typecheck          # tsc over src/ and test/
yarn lint               # eslint (flat config from @companion-module/tools)
yarn format             # prettier
yarn test               # build, then node:test via tsx (needs Node 20 or newer)
yarn presets:generate   # docs/research/phase1-catalog.json -> src/presetCatalog.ts
yarn catalog:render     # docs/research/phase1-catalog.json -> docs/PRESET_CATALOG.md
yarn help:generate      # refresh the preset list in companion/HELP.md
```

The module itself targets Node 18 (Companion's runtime); only the test suite needs Node 20 or newer.

The preset library is data. `docs/research/phase1-catalog.json` is the single source of truth: every
row carries its object path, property path, sources, live-verification result and, where it was
exercised, its write result. Three generators read it — `scripts/gen-presets.mjs` writes
`src/presetCatalog.ts`, `scripts/render-catalog.mjs` writes `docs/PRESET_CATALOG.md` and
`scripts/gen-help.mjs` refreshes the preset list in `companion/HELP.md`. `src/presets.ts` turns the
generated catalog into Companion preset definitions at runtime, applying the connection settings.

To run the module in Companion without a checkout, build a self-contained folder for the
**Developer modules path**:

```bash
yarn build
node scripts/build-dev-module.mjs --label InHouse --version 1.0.0
```

It writes `../InHouse-build/companion-module-disguise-liveupdate` containing only `companion/`,
`dist/`, `package.json` and the production `node_modules` (about 5 MB). Copy that folder into the
Developer modules path; Companion picks it up without a restart. The module id and the variable
prefix stay the same, so existing connections keep working.

Two scripts talk to a real Director and are not part of `yarn test`:

```bash
node scripts/live-verify.mjs --host <director>              # read-only: subscribe to every pair once
node scripts/live-write-verify.mjs --host <director>        # dry run: print the write plan
node scripts/live-write-verify.mjs --host <director> --yes  # write and restore each target
```

`live-write-verify.mjs` changes values on the Director. It reads the original value first, restores
it afterwards, re-reads everything at the end, stops on a failed restore and restores the value in
flight if it is interrupted. Its default target group only touches a track that is not on air; the
`--group output` targets change the live output and are refused while the transport is playing.

## Architecture

- **subscribe / callback / unsubscribe** of the LiveUpdate Variable feedback manage the Director
  subscriptions; identical object/property pairs share one subscription
- values arrive as `valuesChanged` messages and are pushed to Companion variables
- unresolved paths (empty selections, template placeholders) are never sent; failed subscriptions
  are retried with an exponential back-off
- the Set actions and the Compare feedback look up the subscription by variable name

## API Documentation

- [LiveUpdate API](https://developer.disguise.one/api/session/liveupdate/)
- [Monitoring machine health](https://developer.disguise.one/api/guides/monitoring)
- [Designer expressions](https://help.disguise.one/designer/configuration/expressions/accessing-resources)

## License

MIT

## Support

- integrations@disguise.one for questions about the Designer integration
- support@disguise.one / help.disguise.one for general disguise support
