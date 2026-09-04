# companion-module-disguise-liveupdate

Bitfocus Companion module for the disguise Designer **LiveUpdate API**.

## Description

The module connects to the WebSocket LiveUpdate API of a Designer Director and lets you:

- Monitor any Designer property in real time through **feedbacks** that create live Companion
  variables (`$(liveupdate:fps)`, `$(liveupdate:playheadBeats)`, ...)
- Set property values (strings, numbers, booleans, JSON objects) and toggle booleans
- Colour buttons from a value with the **LiveUpdate Compare** feedback
- Drop ready-made buttons from a **preset library** of 203 presets (monitoring, transport state,
  track and layer, layer control, stage and screen, expression variables, RenderStream,
  failover) plus 130 experimental presets; the presets address the show through **selection
  variables** (`selTrack`, `selScreen`, `selMachine`, ...) set once in the connection settings
- Recover automatically from connection loss and subscription errors

LiveUpdate does not carry transport commands (play, stop, cue); pair this module with
[companion-module-disguise-osc](https://github.com/bitfocus/companion-module-disguise-osc) for those.

See [companion/HELP.md](companion/HELP.md) for the user documentation and
[docs/PRESET_CATALOG.md](docs/PRESET_CATALOG.md) for the source of every preset.

## Supported Devices

- disguise Designer with the LiveUpdate API (documented paths verified against the r34 API stubs)
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
yarn build          # tsc
yarn lint           # eslint (flat config from @companion-module/tools)
yarn format         # prettier
yarn presets:generate   # docs/research/phase1-catalog.json -> src/presetCatalog.ts
yarn help:generate      # refresh the preset list in companion/HELP.md
```

The preset library is data: `docs/PRESET_CATALOG.md` (design, sources, verification status) and its
JSON twin `docs/research/phase1-catalog.json` are the input of `scripts/gen-presets.mjs`, which
writes `src/presetCatalog.ts`; `src/presets.ts` turns it into Companion preset definitions at
runtime using the connection settings.

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
