# piggery's view document and what the plugin saves

## `piggery ps --view`

`shared/piggery/view.ts` types the JSON that `piggery ps --view` prints (piggery's `internal/view` package, in Go). The plugin draws what that document says: the rows, their order and groups, their words and counts, the default folds, the tabs and the actions each row allows. Nothing in the plugin decides what to show. `readView` refuses a document whose `version` is not `VIEW_VERSION`; piggery bumps the version only for an incompatible change.

The field names are piggery's, so they can't be renamed here. The less obvious ones:

- `summary.waiting`: participants waiting on a permission or queued, which is what needs the user.
- `tabs[].key`: `""` is All; otherwise a team id or the Closed list's key. Opaque.
- `Row.id`: opaque. A team line's and a gone line's id start with a NUL. Never parse it.
- `Row.open`: a team line's or gone line's default fold, meaning whether its members are listed.
- `Row.folded`: the row is listed only when its team's gone line is open.
- `Head.detail`: the key of the team's entry in `details`.
- `Dir.bucket`: where the directory sorts: `live`, `sleeping`, `gone` (every unit is gone) or `closed` (only closed teams).
- `Dir.folded`: a client that folds starts this directory folded (gone and closed ones). Only `board.dirs` carries it.
- `Column.word`: the word that titles a Board column, not a row's state text.
- `daemon.outdated`: the notice piggery top shows when installs need `piggery setup --outdated`; empty or absent when there is none.

## `piggery tail --view`

One JSON document: a `version`, then `lines` as piggery top shows them. A line's `text` reads as top draws it, glyphs included. `rest` exists only on tool lines and holds the arguments, which the plugin draws muted after the text.

## The "pigmonitor-view" setting

What the user chooses in the surface is kept in Paseo's host setting `pigmonitor-view` (`viewSettings` in `shared/rpc.ts`, read and changed through `shared/folds.ts`), not in piggery. Its keys live in users' saved settings, so renaming one loses what they saved:

- `teams`: a team's open state, kept only where the user chose something other than the view's default. Choosing the default removes the entry.
- `gone`: teams whose gone-members line the user opened. Folded is the default.
- `tab`: the surface's tab.
- `hidden`: project directories the user removed, by path.
- `listWidth`: the Sessions list width.

The surface reads the setting once when it arrives, and saves a moment after the last change, so a burst of clicks is one save. Before saving it calls `prune`, which drops `teams` and `gone` entries for teams the view no longer lists. Solo entries and `hidden` are kept.
