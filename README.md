# Tweet Discord Share

[Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) userscript that shares X/Twitter posts to Discord via webhooks. No X API or server required — runs in your browser on `x.com` / `twitter.com`.

## Install

1. Install Tampermonkey or Violentmonkey.
2. Download **`tweet-discord-share.user.js`** from [Releases](https://github.com/itsreverence/tweet-share/releases):
   - **[latest-main](https://github.com/itsreverence/tweet-share/releases/tag/latest-main)** — newest build from `master`
   - **`v*`** tags — stable snapshots (e.g. [v0.6.1](https://github.com/itsreverence/tweet-share/releases/tag/v0.6.1))
3. Open the file in your browser (or paste into a new userscript) and save.
4. On X, open **Share** on a post → **Share to Discord** (or set up channels first — below).

## Discord channels

1. Tampermonkey menu → **Tweet Discord Share** → **Discord channels…**,  
   **or** **Share** → **Manage channels…** on a post.
2. Add a name and webhook URL, then **Save**.

Create a webhook in Discord: **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook** → copy the URL.

Channels live in extension storage on your machine, not in this repo. **Treat webhook URLs like passwords** — do not commit them to git.

## What it does

- Adds **Share to Discord** to X’s native **Share** menu
- Sends post text, media links, and quote context to the channel you pick
- Scrapes what’s visible on the page (private posts only while you can see them)

## Development

```bash
npm run build   # writes dist/tweet-discord-share.user.js
npm run check   # build + syntax check
```

Edit `userscript/src/`; `npm run build` updates `dist/`.

## License

MIT — see [LICENSE](LICENSE).
