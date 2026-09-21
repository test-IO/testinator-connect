# Production Plan: Auto-Update Readiness

## Goal

Enable Agentic QA - connect to automatically detect, download, and install new
versions on end-user machines (macOS and Windows), without requiring users to
manually re-download installers.

## Current state

An audit of the codebase (2026-09-21) found that auto-update is **not
implemented**: there is no updater dependency, no update-check logic in the
main process, and the release pipeline produces artifacts that are unsigned
(Windows) or ad-hoc signed and not notarized (macOS). CI already builds and
publishes installers to GitHub Releases on every push to `main`
(`.github/workflows/release.yml`), so the distribution channel exists — what's
missing is (1) the update client code and (2) trustworthy, verifiable
artifacts for it to install.

## Why code signing and notarization are blockers, not nice-to-haves

This is the part that needs budget/vendor approval, so it's worth stating
plainly why auto-update cannot work without it — this isn't a hardening
step layered on top of a working feature, it's a hard technical requirement
of the update mechanism itself:

- **macOS: unsigned apps cannot self-update at all.** electron-updater's
  macOS backend (Squirrel.Mac) refuses to apply an update unless both the
  currently running app and the new update package are signed with the same
  valid Developer ID certificate. This isn't a warning dialog that can be
  dismissed — it's a hard failure in the update mechanism. Separately,
  Gatekeeper on macOS 10.15+ blocks unsigned/non-notarized apps from launching
  at all for anyone who downloaded them from outside the Mac App Store,
  showing "Apple could not verify this app is free of malware." Our current
  config sets `identity: "-"` (ad-hoc signing) and `notarize: false`
  (`electron-builder.yml`), so today's builds fail both of these checks.
- **Windows: unsigned installers trigger SmartScreen warnings** ("Windows
  protected your PC") that most users won't click through, and repeated
  unsigned auto-updates look identical to malware to endpoint protection
  tools common in corporate environments — a real risk for a QA tool likely
  to be installed on corporate machines.
- **Without a trusted signature, every update is also a trust decision the
  user has to make manually** — which defeats the purpose of "automatic"
  update. The whole value of auto-update (silent, low-friction version
  currency across the install base) depends on the OS trusting the binary
  enough to install it without a manual override each time.

**What this requires, concretely:**
- **Apple Developer Program membership** (~$99/year) — needed for a Developer
  ID Application certificate (for signing) and access to Apple's notarization
  service (`notarytool` / `@electron/notarize`).
- **A Windows code-signing certificate** from a public CA (e.g. DigiCert,
  Sectigo, SSL.com). An EV (Extended Validation) certificate is strongly
  preferred over OV: EV certs get instant SmartScreen reputation, while OV
  certs must build reputation over time via download/install volume, meaning
  early releases would still get flagged. EV certs typically ship on a
  hardware token or require a cloud HSM (e.g. Azure Trusted Signing,
  DigiCert KeyLocker), which has its own setup/CI implications. Cost is
  roughly $100–$400/year depending on vendor and validation level.

Without these two vendor relationships, everything else in this plan can be
built and tested locally, but the shipped product will not be able to
self-update in the field.

## Action items

### Phase 0 — Vendor acquisition (blocking, needs approval/budget)
- [ ] Enroll in the Apple Developer Program, obtain a Developer ID
      Application certificate.
- [ ] Purchase a Windows code-signing certificate (EV recommended); provision
      access (hardware token or cloud HSM/CI-compatible signing service).
- [ ] Store credentials as GitHub Actions secrets (`CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
      `APPLE_TEAM_ID` for mac; equivalent secrets for the Windows signing
      tool chosen).

### Phase 1 — Updater dependency and main-process wiring
- [ ] Add `electron-updater` to `dependencies` in `package.json`.
- [ ] In the main process (`src/main/index.ts`), instantiate `autoUpdater`
      guarded by `app.isPackaged` (mirroring the existing pattern already
      used at lines 204, 292, 296).
- [ ] Call `autoUpdater.checkForUpdatesAndNotify()` on app ready, and decide
      on a recheck cadence (e.g. every few hours) in addition to on-launch.
- [ ] Add handlers for `update-available`, `update-not-available`,
      `update-downloaded`, `error`, and `download-progress`.
- [ ] Call `quitAndInstall()` after `update-downloaded`, gated on user
      confirmation (not silently killing the app mid-use).

### Phase 2 — Build configuration fixes
- [ ] Add a `zip` target alongside `dmg` under `mac.target` in
      `electron-builder.yml` — electron-updater requires the ZIP artifact to
      perform macOS updates; DMG alone is not sufficient.
- [ ] Confirm `win.target: nsis` (already correct) continues to produce
      `latest.yml` for the update feed.
- [ ] Add a `dev-app-update.yml` for local testing of the update flow against
      unpublished/staged builds.

### Phase 3 — Signing and notarization wiring in CI
- [ ] Set `mac.identity` to the real Developer ID identity (replacing the
      current `"-"` ad-hoc value) and set `notarize` to enable notarization
      (currently explicitly `false`) in `electron-builder.yml`.
- [ ] Uncomment and populate the signing env vars already scaffolded (but
      disabled) in `.github/workflows/release.yml` (`CSC_LINK`,
      `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
      `APPLE_TEAM_ID`).
- [ ] Add equivalent Windows signing secrets/config to `release.yml`, and
      remove or scope down `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` in
      `build.yml` so CI verification builds reflect real signing behavior
      where relevant.

### Phase 4 — Versioning process
- [ ] Stop shipping `package.json.version` frozen at `0.0.1`; bump it per
      release so electron-updater's semver comparison against the published
      feed (`latest.yml` / `latest-mac.yml`) behaves correctly.
- [ ] Reconcile the release-tag scheme: existing tags (`v1.8.x`) don't match
      what `release.yml`'s current `<version>-<sha>` scheme would produce —
      pick one scheme and make it consistent before turning on auto-update,
      since a broken version ordering will cause the updater to loop or
      never detect newer releases.

### Phase 5 — Testing and rollout safety
- [ ] Test the full update cycle locally using `dev-app-update.yml` before
      relying on production releases.
- [ ] Verify signed + notarized builds install cleanly on a clean macOS
      machine (no Gatekeeper prompt) and a clean Windows machine (no
      SmartScreen block).
- [ ] Define a rollback plan (e.g. ability to yank/replace a bad GitHub
      Release) before enabling auto-update for real users, since a bad
      published update now auto-propagates instead of requiring users to
      opt in to a manual download.

### Phase 6 — Update UX (can happen in parallel with Phase 5)
- [ ] Add renderer-side UI for update state: "checking for updates",
      "update available — downloading", progress indicator, and
      "restart to update" prompt tied to the main-process events added in
      Phase 1.

## Sequencing note

Phases 1, 2, and 4 can start immediately with no vendor dependency — they get
the code and config ready. Phase 3 (and therefore any real end-to-end test
against production-shaped, trusted artifacts) is blocked on Phase 0. This
means the vendor purchase is on the critical path for shipping — it isn't a
late-stage polish item that can be deferred to "later."
