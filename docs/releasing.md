# Releasing

A release is a version in `package.json`, an annotated tag `vX.Y.Z` on main and a GitHub release with notes. Paseo installs from Git, so nothing is published to npm.

1. In `CHANGELOG.md`, rename `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD`, open a new empty `[Unreleased]` above it, and update the two links at the bottom.
2. If the plugin now uses a newer Paseo plugin API, raise `requirements.paseo` in `paseo-plugin.json`.
3. Bump the version in `package.json` and `package-lock.json`, check, and commit:

   ```
   npm version X.Y.Z --no-git-tag-version
   npm run check
   git commit -am "Release X.Y.Z"
   ```

4. Tag, push and publish the release with the changelog section as its notes:

   ```
   git tag -a vX.Y.Z -m "PigMonitor X.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   awk '/^## \[X.Y.Z\]/{on=1;next} /^(## )?\[/{on=0} on' CHANGELOG.md > /tmp/notes.md
   gh release create vX.Y.Z --title "PigMonitor X.Y.Z" --notes-file /tmp/notes.md
   ```

5. The listing on [paseo.sh/plugins](https://paseo.sh/plugins) updates on its own. Publishing the release runs `.github/workflows/registry-update.yml`, which pins the release commit in our record in the [registry](https://github.com/getpaseo/plugins), checks it with the registry's validator and opens a pull request there from a fork. The listing changes once the registry's reviewer merges it. Prereleases are skipped. To run it again or list another tag:

   ```
   gh workflow run registry-update.yml -f tag=vX.Y.Z
   ```

   The workflow needs the `PASEO_REGISTRY_TOKEN` secret: a classic token with only the `public_repo` scope, since fine-grained tokens cannot open pull requests on a repository you do not own.

`paseo-plugin.json` has no version field; Paseo's manifest does not define one. `VERSION` is piggery's integration marker (`PIGGERY_INTEGRATION_VERSION`), not PigMonitor's version, so a release leaves it alone.
