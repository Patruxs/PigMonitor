# PigMonitor

A [Paseo](https://github.com/getpaseo/paseo) plugin that shows your piggery agent teams inside Paseo.

https://github.com/user-attachments/assets/29efaaa3-40c8-463a-98e0-a167675429f4

## Requirements

- [piggery](https://github.com/sting8k/piggery): PigMonitor only displays piggery's teams, so it does nothing until piggery is installed. It must be on the Paseo daemon's PATH.
- Paseo 0.11.0 or newer.
- Node 22.5 or newer.

## Install

```
paseo plugin install github:Patruxs/PigMonitor
```

Update to the latest commit on main, or add `--ref` with a release tag to move to that release:

```
paseo plugin update pigmonitor
```

Releases and their notes are on the [releases page](https://github.com/Patruxs/PigMonitor/releases).

PigMonitor then appears in Paseo's sidebar and as a workspace panel.

## What you see

- **Overview**: a timeline of every team and agent, coloured by state, with who needs you and unread mail.

![Overview tab](docs/media/overview.png)

- **Graph**: each team as an org chart. Open any agent or team for its details.

![Graph tab](docs/media/graph.png)

- **Sessions**: read an agent's transcript and mail, write to it, stop its turn or resume an ended session.

![Sessions tab](docs/media/sessions.png)

## Settings

- **piggery binary**: full path to piggery. Empty uses the piggery that installed the plugin, else `piggery` on PATH.
- **piggery database**: the database Sessions reads. Empty means `~/.piggery/piggery.db`.
- **Colours**: the colours of states, roles, mail and teams, as hex or Paseo theme tokens.
- **Avatars**: upload pictures for each role. Auto (the default) assigns them for you, Manual lets you pick per person. PNG, JPEG or WebP, 5 MB max, 128 x 128 px min. Upload from desktop or web only.

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
