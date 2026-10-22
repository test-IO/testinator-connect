---
name: docs-editing
description: Use when someone asks to change the Agentic QA Connect website or usage guide — landing page texts, buttons, links, images, guide steps or screenshots (anything under docs/) — especially a product manager or other non-developer. Triggers on requests like "change the text on the landing page", "update the guide", "replace this screenshot", "fix a typo on connect.testinator.ai".
---

# Editing the Connect website with a non-developer

The person asking usually knows the product, not git or HTML. Your job is to make
their change safely and keep them in the loop in their words. How the site is set up
and how to contribute is in `.claude/rules/docs-site.md` — follow it.

## How to talk

- Answer in the language they write in. Short sentences, plain words.
- No jargon. If a term is unavoidable, explain it once in a few words:
  - *pull request* — "a proposal of the change that a developer checks before it goes live"
  - *branch* — "a separate copy where we prepare the change without touching the live site"
  - *preview* — "the site on your computer only, nobody else sees it"
- Don't show code, commands or diffs unless they ask. Describe changes as
  **before → after** in words ("the button now says *Get the app*").
- One step at a time; say what happens next.
- Never say something is live until the merge happened and you checked the live site.

## Order of work

1. **Understand the change.** Restate it in one or two sentences and ask only what you
   really need (which page, exact new wording, which screenshot). If they send an image,
   ask where it goes if it isn't clear.
2. **Check the scope.** If the request needs anything outside `docs/` (app behaviour,
   download files, the domain), say so plainly and suggest asking a developer — don't do it.
3. **Make the change** on a new branch (rule: "How to contribute").
4. **Show the preview.** Start the local preview (rule: "Local preview") and give them the
   link to the exact page (and `?os=windows` / `?os=mac` for guide steps). Ask: "Does this
   look right?" Adjust until they say yes. The preview must work completely — never show a
   half-working page and explain the gaps away.
5. **Ask before proposing it.** "Shall I send this to the developers for review?" Only on a
   yes: commit, push the branch, open the pull request into `main` (see *Opening the pull
   request* below), and give them its link with one line on what happens next (a developer
   reviews and publishes it).
6. **After it's merged** (they tell you, or you see it), check the live site in a private
   window and confirm in one sentence — or explain plainly what's still missing.

## Before you run or install anything

A terminal suddenly printing lines can worry someone who has never used one. Before any
command they will see running, say in one sentence what it does and that it is safe, and
after it say how it went. Install nothing they don't need right now, and never without a yes.

When the preview needs a tool the computer doesn't have (usually on Windows), ask like this:

> "To show you the site exactly as it will look online, I need to start a small web server
> on your computer — only you can see it, nothing is published. Your computer doesn't have
> the tool for that yet: it's Python, a free and widely used program. Installing it takes a
> couple of minutes and is needed only once. Shall I install it?"

On a no: don't install, don't show a partial preview — tell them a developer will check the
change on the pull request, and continue from step 5.

When you start the preview: "I'm starting the preview — the lines in the terminal are
normal; leave that window open while we look." When you finish: stop it and say so.

## Opening the pull request

You open it with GitHub's command-line tool `gh`. Check first: `gh --version` and
`gh auth status`.

- **`gh` is installed and logged in** — `gh pr create --base main` with a short title and
  description, then share the link.
- **`gh` is missing** — explain in one or two sentences ("a small official GitHub tool that
  lets me send the change for review from here; it needs a one-time install and login") and
  **ask permission** before installing. On a yes:
  - macOS: `brew install gh` (if Homebrew is missing, point them to the installer at
    https://cli.github.com instead of installing Homebrew yourself);
  - Windows: `winget install --id GitHub.cli`.
- **Not logged in** — run `gh auth login` (GitHub.com, HTTPS, log in with a web browser) and
  walk them through it: the tool shows a short code, a browser page opens, they paste the
  code and approve. Then `gh auth setup-git`, so pushing uses the same login.
- **They decline `gh`** — that's fine: push the branch only (`git push -u origin <branch>`),
  then explain how to open the pull request by hand: open the link the push printed (or the
  repository page, where GitHub shows **Compare & pull request** for the new branch), check
  that the target is **main**, add a title and a few lines on what changed, click **Create
  pull request**, and send the link to a developer.

If the push is refused (no access to the repository, or it asks for a login they don't
have), stop and tell them in plain words that a developer has to give them access — don't
work around it.

## When something goes wrong

Say what you saw, in their words, and what you suggest ("the page looks fine, but one
image doesn't load — I'll fix the file name"). If it's outside `docs/` or you're unsure,
stop and suggest asking a developer. Never delete files you didn't add, never touch
`docs/CNAME`.
