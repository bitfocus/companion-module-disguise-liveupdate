# companion-module-disguise-liveupdate

Bitfocus Companion module for the disguise Designer **LiveUpdate API**.

## Description

The module connects to the WebSocket LiveUpdate API of a Designer Director and lets you:

- Monitor any Designer property in real time through **feedbacks** that create live Companion
  variables (`$(liveupdate:fps)`, `$(liveupdate:playheadBeats)`, ...)
- Set property values (strings, numbers, booleans, JSON objects) and toggle booleans
- Colour buttons from a value with the **LiveUpdate Compare** feedback and draw its trend with the
  **LiveUpdate Sparkline** feedback
- Send **transport, RenderStream and failover commands** over Designer's Session REST API on the same
  host and port: LiveUpdate itself cannot carry commands, so no second module is needed for play,
  stop or the section and track jumps
- Drop ready-made buttons from a **preset library** of 310 presets (monitoring, transport state,
  track and layer, layer control, stage and screen, expression variables, RenderStream,
  failover) plus 25 experimental presets; the presets address the show through **selection
  variables** (`selTrack`, `selScreen`, `selMachine`, ...) set once in the connection settings or
  picked from the names the Director reports
- Check every preset against the connected Director from a button
- Recover automatically from connection loss and subscription errors

[companion-module-disguise-osc](https://github.com/bitfocus/companion-module-disguise-osc) is optional;
the transport presets use its variable ids where the value matches, so both can share a page.

See [companion/HELP.md](companion/HELP.md) for the user documentation and
[docs/PRESET_CATALOG.md](docs/PRESET_CATALOG.md) for the source of every preset.

## Supported Devices

- disguise Designer with the LiveUpdate API (documented paths verified against the r34 API stubs, read- and write-checked live on r34.0.3) and the Session REST API for the commands
- Companion 4.1 or newer (module API 1.13)

## Configuration

- **Director IP Address / Port**: the Designer Director (default 127.0.0.1:80); the commands use the
  same host and port
- **Reconnect Interval / Pending Subscription Timeout**: connection housekeeping
- **Preset settings**: show experimental presets; default update intervals per value class; *Read
  selection lists on connect* (default on)
- **Commands**: *Enable commands* (default on), *Allow destructive commands* (default off), *Confirm
  within (s)* (default 5), *Command timeout (ms)* (default 5000)
- **Selections**: the object names the presets use (track, layer, surface, projector, machine, ...)

## Feedbacks

- **LiveUpdate Variable**: subscribes to an object path / property path and exposes the value as a
  variable. The Variable Name uses letters, digits, `_`, `-` and `.`, the characters Companion accepts
  in a variable id; the module's own variable names are reserved
- **LiveUpdate Compare**: boolean comparison of a LiveUpdate Variable (=, ≠, <, ≤, >, ≥, truthy,
  contains); an unknown value (none yet, null, a Director error or a readout marker) satisfies none
- **LiveUpdate Sparkline**: draws the recent values of a variable as a trend line on the button. On
  Companion 5 a button created by hand needs an Image layer first (see HELP, *Seeing a trend*)
- **Command armed**: true on the button whose press armed a destructive command
- **Last command failed**: true while the last command the connection sent did not succeed
- **Connection OK**: true while connected

## Actions

- **Set to Disguise (String / Number / Boolean / JSON)**: write a value through the subscription of a LiveUpdate Variable
- **Toggle Disguise Boolean**: flip a boolean property
- **Set selection** and one action per selection with the names read from the Director; **Set
  selection profile** applies several at once, **Refresh selection lists** re-reads them
- **Check presets against this Director**: subscribes once to every preset property whose selections
  are filled in and reports the counts in the `selfcheck_*` variables
- **Transport: ...** (play, stop, play / loop section, return to start, next and previous section and
  track, go to section / note / tag / track / timecode / time, brightness, volume, speed, engaged),
  **RenderStream: ...** (start, stop, restart and sync layers) and **Failover: ...** (fail over and
  restore a machine, apply default routing), sent over Designer's Session REST API. Transport commands
  fire on one press whenever commands are enabled, *Stop*, brightness 0 and volume 0 included. Only the
  RenderStream and Failover commands are gated: they are refused until *Allow destructive commands* is
  on, and then need two presses of the same button
- **Command: rescan the command API**: forget which commands this Director answered 404 or 405 for

## Variables

- `connection_status`: `Connected` / `Disconnected`
- `designer_version`: Designer version of the connected Director, read on every connection
- `selfcheck_progress`, `selfcheck_ok`, `selfcheck_failed`, `selfcheck_skipped`: the preset check
- `rest_last_command`, `rest_last_status` (`OK` / `FAILED` / `UNSUPPORTED`), `rest_last_message`: the
  last command sent and its result
- `rest_armed`: the most recent destructive command waiting for its second press
- `selTrack`, `selLayer`, ...: selection variables (`$NA` while empty)
- one variable per LiveUpdate Variable feedback. Instead of a value it can hold `OFFLINE` (no
  connection), `ERROR` (object path refused), `PATH_ERROR` / `PATH_ERROR (unsubscribed)` (property
  path refused) or `UNSET` (the path cannot be resolved yet, for example an empty selection); the
  preset buttons show these words as they are

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
generated catalog into Companion preset definitions at runtime, applying the connection settings and
the connection's own label. `scripts/gen-presets.mjs` refuses to generate when a button text would
hide one of the readout markers (`SENTINELS` in `src/variables.ts`) or an undefined value, or would
render NaN, and when preset content carries a `<redacted` placeholder.
`scripts/companion-expression.cjs` renders a button text with Companion 5.0.4's expression semantics
for that check (it uses the `typescript` devDependency).

### Tests

`yarn test` runs the whole suite in about 18 s; nothing in it talks to a real Director. The
lifecycle tests load the built `dist/` through `test/harness.ts`, which replaces
`@companion-module/base` with a stub host that drives the real module-base FeedbackManager, and `ws`
with an in-process fake socket connected to a `FakeDirector`:

- `settle()` waits by event-loop turns plus one 30 ms tick (module-base debounces feedback values), so
  it takes the same time on every machine; `until(predicate)` waits for a condition, and a test that
  must see a longer timer (back-off, write coalescing) waits for it with `tick(ms)`.
- The `FakeDirector` answers the Designer version pair with `r34.0.3` by default (option `version`;
  `null` treats it as an ordinary pair). `count()` and `subscribedProperties()` leave out that
  connect-time version read; `received` has it. `hold()` / `release()` keep replies back while a test
  acts on requests in flight, `unreachable` never opens the socket and `refs()` is the Director's
  reference count of a pair.
- `newInstance()` connects to host 127.0.0.1, `host.feedbackValues` holds what each feedback last
  reported to the host, and `destroyInstances()` (registered with `afterEach`) stops the timers of an
  instance a failed test left behind.
- `host.variables` keeps the values the way module-base 1.13.6 does: a defined variable holds `''`
  until something else is written and `''` again when `undefined` is written; only a name that is not
  defined has no value, which Companion shows as `$NA`.

`test/integration.test.ts` runs over a real WebSocket against `test/mock-director.ts`,
`test/rest.test.ts` against a mock Session REST API on 127.0.0.1, and `test/scripts.test.ts` checks the
safety rules of the scripts below without running them against a Director.

### Developer module build

To run the module in Companion without a checkout, build a self-contained folder for the
**Developer modules path**:

```bash
yarn build
node scripts/build-dev-module.mjs --label InHouse --version 1.1.0-inhouse.1
```

It writes `<out>/companion-module-disguise-liveupdate` containing `companion/`, `dist/`, `LICENSE`,
`README.md`, a slim `package.json` (no dev dependencies or scripts) and the production `node_modules`
(about 5 MB). `--out` is resolved relative to the checkout and defaults to `../dev-module-build`.
`--version` defaults to the version in `package.json` and must be semver (`1.1.0-inhouse.1`); a bare
`--version` or a non-semver value exits 1. The module id and the variable prefix stay the same, so
existing connections keep working. Copy the folder into the Developer modules path; Companion picks it
up without a restart.

The script only ever deletes its own earlier build. It refuses an `--out` that is a drive or
filesystem root, the home folder or one of its parents, the checkout itself or any folder that
contains the checkout, so the Developer modules path cannot be used directly when it holds the clone:
build elsewhere and copy the folder in. An existing output folder is replaced only when it looks like
an earlier build (`companion/manifest.json` with the id `disguise-liveupdate`, and no `.git` or `src`
folder) or is empty; anything else makes the script exit 1 without touching it. When the earlier build
is locked because a running Companion has it loaded (EBUSY, EPERM, EACCES or ENOTEMPTY), the files are
overwritten in place and the script says so; files the new build no longer has stay behind until the
folder can be deleted.

### Scripts that talk to a Director

Four scripts talk to a real Director and are not part of `yarn test`. `rest-discover.mjs` and
`live-verify.mjs` only read; `live-write-verify.mjs` and `rest-command-verify.mjs` change the Director
when run with `--yes` and print their plan (a dry run) without it:

```bash
node scripts/rest-discover.mjs --host <director>            # read-only: read the Director's own OpenAPI document
node scripts/live-verify.mjs --host <director>              # read-only: subscribe to every pair once
node scripts/live-write-verify.mjs --host <director>        # dry run: print the write plan
node scripts/live-write-verify.mjs --host <director> --yes  # write and restore each target
node scripts/rest-command-verify.mjs --host <director>      # dry run: print the command plan
node scripts/rest-command-verify.mjs --host <director> --yes --group all
```

They write their raw output to `.live/` at the repository root, which git ignores:
`.live/rest-api.json`, `.live/live-verification.json`, `.live/live-write-verification.json` and
`.live/rest-verification.json`. That output holds site data (the Director's address, project, track,
layer, screen and machine names, uids), and every run that writes it prints a reminder, louder when an
`--out` puts it inside the checkout but outside `.live/`. The files under `docs/research` are the
committed, scrubbed evidence: writing there needs an explicit `--out`, and the file must be scrubbed
before it is committed. `scripts/live-verify.config.json`, the optional selection values for
`live-verify.mjs`, is git-ignored too.

The write scripts exit 0 when the run was clean, 1 on a failure or when something was not restored or
not confirmed, and 2 when a guard refused before writing (or on a usage error). Their guards fail
closed: a state they cannot read counts as the unsafe one. `--force` overrides the track and play-state
guards, not every refusal: `rest-command-verify.mjs` exits 1 without sending anything when the
Director reports no active transport or the playhead cannot be read over LiveUpdate, with or without
`--force`.

`live-write-verify.mjs` changes values on the Director. It reads the original value first, restores
it afterwards, re-reads everything at the end, stops on a failed restore and restores the value in
flight if it is interrupted. Its default target group, `neutral`, only touches a track that is not the
transport's current track; with `--yes` it is refused when the track it would use is the current one
(a single-track project, or `--track` naming the current track) or when the current track could not
be read. The `--group output` targets change the live output and are refused while the transport is
playing or when the playing state could not be read. The dry run says when `--yes` would be refused,
and a refused run still writes its results file with a `refused` entry. If the Director closes the
connection mid-run, the script restores the value in flight when it can, prints
`SET THIS BACK BY HAND: <object> / <property> = <value>` for anything it could not restore and exits 1.
A final read-back that cannot read a value is recorded as `UNVERIFIED: <reason>` and counts as not
confirmed; the verdict lists values not restored and values not confirmed separately.

`rest-command-verify.mjs` sends the REST commands to the Director. Every step reads the state first
and puts it back afterwards, and a step that is interrupted still restores. The brightness, volume,
speed, engaged, time, timecode, return-to-start and play / stop steps fail when the read-back does not
show the command's effect. The section and note jumps, next / previous track and `synclayers` record
what the Director showed and pass once the command was accepted (a set list with one track cannot
change track); go to track selects the track that is already current and fails if the track changes.
It never sends a failover command, and of the RenderStream commands only `synclayers`: starting or
stopping a workload is not undone by a second command. It needs a stopped transport: `--yes` is
refused while the play mode is not Stop or cannot be read, unless `--force` is given. With `--force`,
once the final sweep has put track, time, brightness, volume, speed and engaged back, the script
resumes the original play mode from the start position (`/transport/play`, `/transport/playsection`
or `/transport/playloopsection`). A refused or failed restore fails its step. The final sweep compares
track, brightness, volume, speed, engaged, playhead time and play mode with the start; any difference
prints `!! SET THIS BACK BY HAND: field = wanted (the Director reports seen); ...`, adds a failed
`restore` entry to the results file and makes the run exit 1. The results record the host as
192.0.2.10 and the Designer version given with `--designer` (default `r34.0.3`).
`docs/research/rest-verification.json` is the scrubbed result of the 2026-09-04 run on r34.0.3.

The script builds its own request bodies: it addresses the transport by uid and name as the Director
reports it, and was written before the module had Go to tag. The module addresses objects by name
unless told otherwise (`uid:` / 6+ digits), sends the section number as a string of digits, and has a
Go to tag action, so those bodies were not the ones sent in that run. `test/rest-schema.test.ts` checks
every body the module sends, by name and by uid, against the Director's own description of the command
in `docs/research/rest-api.json`.

## Architecture

- **subscribe / callback / unsubscribe** of the LiveUpdate Variable feedback manage the Director
  subscriptions; identical object/property pairs share one subscription, which runs at the fastest
  update interval any placed feedback asks for (`0`, as fast as possible, beats any number)
- subscribe requests made together leave as one frame per object and update interval
- values arrive as `valuesChanged` messages and are pushed to Companion variables; a confirmation
  re-runs only the feedbacks it concerns, and variable definitions are sent only when they change
- unresolved paths (empty selections, template placeholders, unparsed variables) are never sent and
  show `UNSET`; failed subscriptions are retried with an exponential back-off (2 s doubling up to
  60 s) on their own timer
- the Set actions and the Compare feedback look up the subscription by variable name
- the command actions post to `/api/session/...` on the Director (`src/rest.ts`); commands the
  Director answers 404 or 405 for are remembered until the rescan action or a settings save

## API Documentation

- [LiveUpdate API](https://developer.disguise.one/api/session/liveupdate/)
- [Monitoring machine health](https://developer.disguise.one/api/guides/monitoring)
- [Designer expressions](https://help.disguise.one/designer/configuration/expressions/accessing-resources)

## License

MIT

## Support

- integrations@disguise.one for questions about the Designer integration
- support@disguise.one / help.disguise.one for general disguise support
