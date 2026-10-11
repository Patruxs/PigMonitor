# PigMonitor

A [Paseo](https://github.com/getpaseo/paseo) plugin that shows your piggery agent teams inside Paseo.

<!-- video: PigMonitor in Paseo -->
A short tour of PigMonitor in Paseo (suggested file: docs/media/pigmonitor.mp4).

## Install

You need Paseo 0.11.0 or newer, piggery on the Paseo daemon's PATH, and Node 22.5 or newer.

Install:

```
paseo plugin install github:Patruxs/PigMonitor
```

Update to the latest version:

```
paseo plugin update pigmonitor
```

PigMonitor then appears in Paseo's sidebar and as a workspace panel.

## What you see

- **Overview**: a timeline of every team and agent, coloured by state, with who needs you and unread mail.

<!-- image: Overview tab -->
The Overview tab with a few teams at work (suggested file: docs/media/overview.png).

- **Graph**: each team as an org chart. Open any agent or team for its details.

<!-- image: Graph tab -->
The Graph tab with a team's org chart (suggested file: docs/media/graph.png).

- **Sessions**: read an agent's transcript and mail, write to it, stop its turn or resume an ended session.

<!-- image: Sessions tab -->
The Sessions tab with an agent's chat open (suggested file: docs/media/sessions.png).

## Settings

- **piggery binary**: full path to piggery. Empty uses the piggery that installed the plugin, else `piggery` on PATH.
- **piggery database**: the database Sessions reads. Empty means `~/.piggery/piggery.db`.
- **Colours**: the colours of states, roles, mail and teams, as hex or Paseo theme tokens.

## Development

```
git clone https://github.com/Patruxs/PigMonitor.git
paseo plugin install ./PigMonitor
paseo plugin reload pigmonitor
npm install
npm run check
```

Reload after each change. Notes: [docs/piggery-view.md](docs/piggery-view.md) and [docs/ui.md](docs/ui.md).

## License

MIT
