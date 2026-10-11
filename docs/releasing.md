# Releasing

A release is a version in `package.json`, an annotated tag `vX.Y.Z` on main and a GitHub release with notes. Paseo installs from Git, so nothing is published to npm.

1. In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, open a new empty `[Unreleased]` above it, and update the two links at the bottom.
2. Point the README's install command at the new tag: `--ref vX.Y.Z`.
3. If the plugin now uses a newer Paseo plugin API, raise `requirements.paseo` in `paseo-plugin.json`.
4. Bump the version in `package.json` and `package-lock.json`, check, and commit:

   ```
   npm version X.Y.Z --no-git-tag-version
   npm run check
   git commit -am "Release X.Y.Z"
   ```

5. Tag, push and publish the release with the changelog section as its notes:

   ```
   git tag -a vX.Y.Z -m "PigMonitor X.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   awk '/^## \[X.Y.Z\]/{on=1;next} /^(## )?\[/{on=0} on' CHANGELOG.md > /tmp/notes.md
   gh release create vX.Y.Z --title "PigMonitor X.Y.Z" --notes-file /tmp/notes.md
   ```

`paseo-plugin.json` has no version field; Paseo's manifest does not define one. `VERSION` is piggery's integration marker (`PIGGERY_INTEGRATION_VERSION`), not PigMonitor's version, so a release leaves it alone.
