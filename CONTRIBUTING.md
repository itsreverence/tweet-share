# Contributing

Thanks for helping improve Tweet Discord Share.

## Before opening a change

- Use an issue for larger behavior changes so the scope can be agreed first.
- Never commit Discord webhook URLs, cookies, session data, or private/protected post content.
- Keep the project manual-share, local-first, and userscript-based. Bulk scraping, access-control bypass, spam, and account automation are outside its scope.

## Local setup

Requirements: Node.js 22 or newer. The project currently has no third-party runtime or development dependencies.

```bash
git clone https://github.com/itsreverence/tweet-share.git
cd tweet-share
npm test
npm run check
```

Edit source modules under `userscript/src/`. Module filenames are concatenated in lexical order by `scripts/build.mjs`; do not edit the generated `dist/tweet-discord-share.user.js` directly.

## Verification

Before opening a pull request, run:

```bash
npm test
npm run check
git diff --check
```

`npm run check` rebuilds the userscript, checks JavaScript syntax, and verifies that the committed distribution matches the source and `package.json` version.

Add or update focused tests for behavior changes. Avoid fixtures containing live credentials or private content.

## Pull requests

Keep changes scoped and explain:

- what changed and why;
- how it was tested;
- whether webhook handling, stored settings, userscript grants, or release output changed;
- any manual X/Twitter and Discord checks performed.

Maintainers may ask for screenshots, but redact account names, private posts, channel names, and webhook data first.

## Releases

Maintainers bump `package.json` and rebuild `dist/` in a pull request. After that pull request merges to `master`, the release workflow publishes a new `v{version}` only when that tag does not already exist.
