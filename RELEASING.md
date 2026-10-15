# Releasing Agentic QA Connect

Releases are cut from a tag. Every release is published to
[GitHub Releases](https://github.com/test-IO/testinator-connect/releases) and becomes
`releases/latest`, which is what running apps update to and what the landing page links to.

## Cut a release

```bash
git checkout main && git pull
npm version 0.2.0 -m "[NO-TICKET] Release %s"
git push origin main --follow-tags
```

`npm version` bumps `package.json`, commits, and creates the tag `v0.2.0`.
Platform releases no longer tag this repo; older platform tags (`v1.2.3` … `v1.10.x`) are still
here, and `npm version` refuses to reuse one of them.

The `Release` workflow checks the tag against `package.json`, runs the tests, and creates a
draft release. The macOS and Windows jobs upload installers plus `latest.yml` / `latest-mac.yml`
to that draft; once both finish, the `publish` job makes it public and `releases/latest`.

## First release (0.1.0)

`package.json` is already `0.1.0`, so `npm version 0.1.0` fails ("Version not changed").
After the PR merges, tag directly:

```bash
git checkout main && git pull
git tag v0.1.0 && git push origin v0.1.0
```

Merge Task 6 first (testinator-meta: platform releases no longer tag this repo).

## If a build fails

The release stays a draft, so users are unaffected. Fix the cause and re-run the failed jobs,
or delete the draft release and the tag, then re-tag.

## Verify

- The release lists `Agentic-QA-Connect-mac-arm64.dmg`, `-mac-x64.dmg`, both `.zip` files,
  `Agentic-QA-Connect-Setup-win-x64.exe`, `latest.yml` and `latest-mac.yml`.
- An installed previous version shows "Downloading <version>" within a minute of launch
  (Windows only until macOS builds are signed).

## A bad release

Apps never downgrade. Fix forward: revert the change on `main`, release a higher version
(e.g. `0.2.1`), and running apps pick it up on their next check (launch, then every 4 hours).
Do not delete the bad release until the fix is out — `releases/latest` would fall back to the
previous version, but apps already on the bad one stay there until a higher version exists.

## Emergency: ship a version with auto-update disabled

If a coming change would break installations that cannot be upgraded in time, stop updates
before it ships:

1. Repo → Settings → Secrets and variables → Actions → Variables: set `AUTO_UPDATE_ENABLED=false`.
2. Release the current, still-compatible code as a new version (e.g. `0.4.1`).
   Running apps update to it once, then stop checking ("Manual updates only").
3. Turn updates back on later by setting `AUTO_UPDATE_ENABLED` back to `true` (or deleting it).
   Machines on the emergency version need one manual download from the landing page.

This only works before the breaking version is published: apps never downgrade.
