A [Paseo](https://github.com/getpaseo/paseo) plugin that shows your piggery agent teams inside Paseo.

[Demo video](https://github.com/user-attachments/assets/29efaaa3-40c8-463a-98e0-a167675429f4)

## Requirements

- [piggery](https://github.com/sting8k/piggery): PigMonitor only displays piggery's teams, so it does nothing until piggery is installed. It must be on the Paseo daemon's PATH, or set its full path in Settings.
- Paseo 0.11.0 or newer.
- Node 22.5 or newer.

PigMonitor appears in Paseo's sidebar and as a workspace panel.

## What you see

- **Overview**: a timeline of every team and agent, coloured by state, with who needs you and unread mail.

![Overview tab](https://raw.githubusercontent.com/Patruxs/PigMonitor/main/docs/media/overview.png)

- **Graph**: each team as an org chart. Open any agent or team for its details.

![Graph tab](https://raw.githubusercontent.com/Patruxs/PigMonitor/main/docs/media/graph.png)

- **Sessions**: read an agent's transcript and mail, write to it, stop its turn or resume an ended session.

![Sessions tab](https://raw.githubusercontent.com/Patruxs/PigMonitor/main/docs/media/sessions.png)

## Settings

- **piggery binary**: full path to piggery. Empty uses the piggery that installed the plugin, else `piggery` on PATH.
- **piggery database**: the database Sessions reads. Empty means `~/.piggery/piggery.db`.
- **Colours**: the colours of states, roles, mail and teams, as hex or Paseo theme tokens.
- **Avatars**: upload pictures for each role. Auto (the default) assigns them for you, Manual lets you pick per person. PNG, JPEG or WebP, 5 MB max, 128 x 128 px min. Upload from desktop or web only.

## What it reads and changes

Looking only reads: it runs `piggery ps` and `piggery tail` with `--no-start`, so it never starts a piggery daemon, and opens the database read-only. While Paseo runs, the plugin asks `piggery ps` every 5 s and keeps each agent's state changes for the timeline in `~/.paseo/plugin-data/pigmonitor/states.json` (the last 7 days). Uploaded avatars are kept in `~/.paseo/plugin-data/pigmonitor/avatars`.

These buttons change agents through piggery, only where piggery allows it: Stop (`piggery abort`), and in a worker's menu Switch model or thinking (`piggery model`), Kill worker (`piggery kill`), Resume in its team (`piggery resume`) and Release held mail (`piggery release`). Kill, model and resume ask first. For a session open in Paseo, the chat's own Stop, Rewind and model, mode and thinking controls act on that Paseo agent, and Resume in Paseo imports an ended Claude session (`paseo import`). Sending mail registers the plugin as its own piggery person.
