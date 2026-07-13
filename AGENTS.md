# Agent Notes

Tweet Discord Share is a local-first browser userscript for manually sharing posts the user can already view to a chosen Discord webhook.

## Boundaries

- Do not add bulk scraping, access-control bypass, spam, account automation, analytics, or a hosted backend.
- Never add live webhook URLs, cookies, session details, or private/protected content to source, fixtures, logs, issues, or screenshots.
- Keep webhook destinations in userscript-manager storage.
- Treat changes to userscript grants, connected hosts, storage, network delivery, or release publishing as security-sensitive.
- Edit `userscript/src/` and the metadata template; do not hand-edit the generated distribution.

## Verification

Follow `CONTRIBUTING.md`. At minimum run:

```bash
npm test
npm run check
git diff --check
```

Keep the README focused on installation, first use, safety, and support. Put implementation shape in `docs/ARCHITECTURE.md` and contributor workflow in `CONTRIBUTING.md`.
