---
paths:
  - "docs/**"
---

# The Connect website (`docs/`)

`docs/` is the public website at **https://connect.testinator.ai**: the landing
page and the usage guide. It is not part of the desktop app. Whoever asks for a
change here is usually a product manager, not a developer — talk to them the way
`.claude/skills/docs-editing/` describes.

## How it is published

- GitHub Pages, mode **Deploy from a branch**: branch `main`, folder `/docs`.
  Every push to `main` republishes the site; it is live 1–2 minutes later.
- No build step and no Jekyll setup of our own (no `_config.yml`, no `.md` pages):
  `.html`, `.js` and images are served as they are. Pages still passes the folder
  through Jekyll by default, so a file or folder whose name starts with `_` is **not
  published** — don't name anything that way.
- `docs/CNAME` holds the domain `connect.testinator.ai`. Never edit, move or
  delete it — the site would fall back to `test-io.github.io` and the domain breaks.
- The browser and Pages cache files for up to 10 minutes. After a publish, check in
  a private/incognito window before deciding something "didn't work".

## What lives where

| Path | What it is |
|---|---|
| `docs/index.html` | Landing page |
| `docs/assets/images/` | Landing images |
| `docs/assets/js/download.js` | Download buttons logic (OS / Mac chip detection) |
| `docs/guide/index.html` | Usage guide (one page, Windows / macOS switch in the sidebar) |
| `docs/guide/assets/images/` | Guide screenshots |
| `dev-docs/` | Developer notes — not published, not for this kind of change |

Rules for the files:
- Links and image paths are **relative** (`assets/images/x.png`, `guide/`), never
  starting with `/` — the site must work on any domain.
- New images go into the `assets/images/` folder next to the page that uses them
  (PNG or JPG, sensible size — a screenshot is fine, a 10 MB photo is not), and get
  a meaningful `alt` text.
- In the guide, steps that differ by OS sit in elements with `data-os="windows"` or
  `data-os="mac"`; keep that when editing them.
- Stay inside `docs/`. Anything else (`src/`, `.github/`, `package.json`,
  `electron-builder.yml`, …) is app code: stop and hand it to a developer.

## How to contribute

1. Start from fresh `main`: `git checkout main && git pull`, then a branch named
   `docs/<short-description>` (e.g. `docs/landing-new-headline`).
2. Make the change; check it locally (below).
3. Commit with a short, plain message, push the branch, open a pull request
   **into `main`** with a 2–5 line description of what changed and why.
   With `gh` if it is installed and logged in; otherwise push the branch and open the
   pull request on github.com (setup and the manual way: `.claude/skills/docs-editing/`).
4. Never push to `main` directly, never force-push, never merge the pull request
   yourself — a developer reviews and merges it with **Squash and merge**.
5. After the merge, check the live site (below, step 3).

## How to know everything is OK

1. **Local preview** — always through a small local web server, never by opening the
   `.html` file directly: opened as a file, the download buttons' script doesn't run and
   links between pages open folder listings, so the preview would look broken. Use what
   the machine already has, in this order:
   - macOS: the built-in Ruby — `ruby -run -e httpd docs -p 8080`;
   - any OS with Python — `python3 -m http.server --directory docs 8080`
     (`python` on Windows);
   - any OS with Node — `npx --yes http-server docs -p 8080`.

   Nothing found (typical on Windows): explain and ask before installing one — the
   wording is in `.claude/skills/docs-editing/`. Install Python
   (`winget install -e --id Python.Python.3.12`, or the installer from python.org).

   Then open http://localhost:8080/ and http://localhost:8080/guide/ (and the guide with
   `?os=windows` and `?os=mac`). Look at the part that changed; make sure no image is
   broken and the links you touched go where they should. Stop the server when done.
2. **The pull request checks** — a `docs/`-only change runs one check, **Site**
   (`npm run test:site`, tests of `download.js`), and skips the app build. It must be
   green. If `download.js` or `tests/site/` changed, run `npm run test:site` before
   pushing.
3. **After the merge** — the `pages build and deployment` run in GitHub Actions turns
   green, then the change is visible on https://connect.testinator.ai in a private
   window.

If any of these fails and the reason isn't obvious, stop and say so in plain words;
don't guess at fixes outside `docs/`.
