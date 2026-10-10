# PigMonitor

A [Paseo](https://github.com/getpaseo/paseo) plugin that shows your piggery agent teams inside Paseo.

## Install

```
paseo plugin install github:Patruxs/PigMonitor
```

PigMonitor then appears in Paseo's sidebar and as a workspace panel.

To update to the latest version:

```
paseo plugin update pigmonitor
```

## What it shows

- **Overview**: a timeline of every team and agent, coloured by state (working, waiting, idle, exited), with counts of who needs you and unread mail.
- **Graph**: each team as an org chart.
- **Sessions**: read an agent's transcript and mail, and write to it. Pasted images are attached. Stop a session's current turn, or resume an ended Claude session in Paseo.
- Open any agent or team for its details.

Looking only reads: it runs `piggery ps --view` and `piggery tail --view` with `--no-start`, and reads piggery's SQLite database read-only. While Paseo runs, the plugin asks `piggery ps --view` every 5 s and keeps each agent's state changes for the Overview timeline in `~/.paseo/plugin-data/pigmonitor/states.json` (the last 7 days). These buttons change agents through piggery, only where piggery allows it: Stop (`piggery abort`), and in a worker's menu Switch model or thinking (`piggery model`), Kill worker (`piggery kill`), Resume in its team (`piggery resume`) and Release held mail (`piggery release`). Kill, model and resume ask first. For a session open in Paseo, the chat's own Stop, Rewind and model, mode and thinking controls act on that Paseo agent, and Resume in Paseo imports an ended Claude session (`paseo import`). Sending mail registers the plugin as its own piggery person.

## Requirements

- Paseo 0.9.1 or newer.
- piggery on the Paseo daemon's PATH.
- Node 22.5 or newer (for `node:sqlite`).

## Settings

In Paseo, Settings → PigMonitor:

- **piggery binary**: full path to piggery. Empty means `piggery` on PATH.
- **piggery database**: the database the Sessions tab reads. Empty means `~/.piggery/piggery.db`, in piggery's home.
- **Colours**: the colours of states, roles, mail and teams. Each takes a hex colour (`#rgb`, `#rrggbb`, `#rrggbbaa`) or a Paseo theme token such as `statusSuccess`; team lanes take 1 to 8 hex colours. Copy palette as JSON and Paste palette JSON share a palette.

## Development

```
git clone https://github.com/Patruxs/PigMonitor.git
paseo plugin install ./PigMonitor
```

No build step: Paseo loads the TypeScript sources directly. After changing the code:

```
paseo plugin reload pigmonitor
```

Type check and tests (the dev dependencies are only for the type check; Paseo does not install or read them):

```
npm install
npm run check
```

Developer notes: [docs/piggery-view.md](docs/piggery-view.md) covers piggery's view document and the setting the plugin saves; [docs/ui.md](docs/ui.md) covers how the UI is built.

## License

MIT
