# Releasing Agentic QA Connect

A release is made when `main` gets a new `version` in `package.json`. Every release is
published to [GitHub Releases](https://github.com/test-IO/testinator-connect/releases) and
becomes `releases/latest`, which is what running apps update to.

## Cut a release

Bump the version in the PR that should ship:

```bash
npm version 0.2.0 --no-git-tag-version
```

Commit `package.json` and `package-lock.json` with the PR. When it merges, the `Release`
workflow sees that `v0.2.0` has no release yet, runs the tests, and creates a draft release.
The macOS and Windows jobs upload installers plus `latest.yml` / `latest-mac.yml` to that
draft; once both finish, the `publish` job makes it public and `releases/latest`.

Merges that keep the same version (docs, CI, landing page) release nothing.

The workflow fails instead of releasing when the version:

- has a pre-release suffix (`0.2.0-beta.1`);
- is not higher than the latest release (apps never downgrade);
- already has a tag without a release, like the old platform tags `v1.2.3` … `v1.10.x`.

## macOS signing

The macOS job signs with the Developer ID Application certificate and notarizes the app.
Repo secrets: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Check the job log for
`identityName=Developer ID Application: …` and `notarization successful`.

The macOS updater is off until the repo variable `MAC_SIGNING_ENABLED=true` is set.
Set it only after a signed, notarized release installs and runs; builds made after that
update themselves.

If the Apple ID password changes, its app-specific password stops working: create a new one
and update `APPLE_APP_SPECIFIC_PASSWORD`.

## If a build fails

The release stays a draft, so users are unaffected. Fix the cause and re-run the failed jobs.
If the fix needs a new commit, merge it with the same version: the next run replaces the
draft and releases again.

## Verify

- The release lists `Agentic-QA-Connect-mac-arm64.dmg`, `-mac-x64.dmg`, both `.zip` files,
  `Agentic-QA-Connect-Setup-win-x64.exe`, `latest.yml` and `latest-mac.yml`.
- An installed previous version shows "Downloading <version>" within a minute of launch
  (on macOS only once `MAC_SIGNING_ENABLED=true`).

## A bad release

Apps never downgrade. Fix forward: revert the change on `main` and bump to a higher version
(e.g. `0.2.1`), and running apps pick it up on their next check (launch, then every 4 hours).
Do not delete the bad release until the fix is out — `releases/latest` would fall back to the
previous version, but apps already on the bad one stay there until a higher version exists.

## Emergency: ship a version with auto-update disabled

If a coming change would break installations that cannot be upgraded in time, stop updates
before it ships:

1. Repo → Settings → Secrets and variables → Actions → Variables: set `AUTO_UPDATE_ENABLED=false`.
2. Merge a version bump of the current, still-compatible code (e.g. `0.4.1`).
   Running apps update to it once, then stop checking ("Manual updates only").
3. Turn updates back on later by setting `AUTO_UPDATE_ENABLED` back to `true` (or deleting it).
   Machines on the emergency version need one manual download from the landing page.

This only works before the breaking version is published: apps never downgrade.
