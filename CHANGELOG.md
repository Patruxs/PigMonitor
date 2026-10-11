# Changelog

All notable changes to PigMonitor are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-11

### Added

- Avatars for people with a role, set in Settings → Avatars: each role has its own library of pictures you upload, several at once by choosing, dropping or pasting them (PNG, JPEG or WebP, square-cropped and stored at 256 x 256), from Paseo desktop or web, and in Auto, the default, everyone gets a picture from their role's library by itself, each used once per role in a team, live teams first, newcomers included; when a team has more people in a role than pictures, its latest arrivals keep their initials. In Manual a role with one picture gives it to everyone, and a role with several lists its people so you pick each one's picture (pictures may be shared). Everyone shows initials until their role has pictures.
- The manifest names the plugin and lists screenshots of the Overview, Graph and Sessions tabs for its page on paseo.sh/plugins. The screenshots ship in `docs/media`.

### Changed

- Events on the Overview timeline sit at the time piggery logged them, and events that fall close together share one dot that shows how many there are, coloured by the most serious of them.
- The current state's bar on the Overview timeline stays visible however short it is, and an exit's label moves to the left when it would run past the edge.
- The README shows how to install a release with `--ref` and says that `paseo plugin update` follows the main branch unless given a release tag.

### Fixed

- PigMonitor now requires Paseo 0.11.0 or newer. 0.1.0 declared 0.9.1, but its sidebar entry and screen use plugin APIs that first shipped in Paseo 0.11.0.

## [0.1.0] - 2026-10-11

First release.

### Added

- Overview: a timeline of every team and agent, coloured by state, with who needs you and unread mail. State changes are kept for 7 days.
- Graph: each team as an org chart. Any agent or team opens a detail dialog.
- Sessions: read an agent's transcript and mail, write to it with pasted images attached, stop its turn, or resume an ended Claude session in Paseo.
- A workspace panel with the same views, scoped to that workspace's directory.
- Settings for the piggery binary, the piggery database and the colour palette.
- Looking only reads: `piggery ps --view` and `piggery tail --view` with `--no-start`, and piggery's database opened read-only. Stop, Kill, Switch model, Resume and Release held mail go through piggery, and the destructive ones ask first.

[Unreleased]: https://github.com/Patruxs/PigMonitor/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Patruxs/PigMonitor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Patruxs/PigMonitor/releases/tag/v0.1.0
