# Tweet Discord Share

Share X/Twitter posts into Discord with the visible post text, media, and quote-post context. This is a [Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) userscript for personal use. It does not require the X API or a running server.

## Install (one file to paste)

1. Install Tampermonkey or Violentmonkey.
2. Get the built userscript:
   - **Releases** (recommended): open [GitHub Releases](https://github.com/itsreverence/tweet-share/releases), download `tweet-discord-share.user.js` from the latest tag.
   - **From clone**: run `npm run build` and use `dist/tweet-discord-share.user.js`.
3. Copy the entire file into a new userscript and save.
4. Edit `DIRECT_DESTINATIONS` near the top of that file (search for `DIRECT_DESTINATIONS`) and add your Discord webhooks.
5. Open X/Twitter and use the **Discord** button on a post.

You only need **one** `.user.js` file in the extension. Source lives in `userscript/src/`; `npm run build` merges it into `dist/`. Tagged pushes (`v*`) publish that file to Releases automatically.

## Configure destinations

Add channels in `userscript/src/00-config.js`, then run `npm run build` and reinstall from `dist/`. Or edit `DIRECT_DESTINATIONS` directly in the installed script / `dist` file.

```js
const DIRECT_DESTINATIONS = [
  {
    id: "friends",
    label: "Friends server - tweets",
    webhookUrl: "https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN"
  }
];
```

Create webhooks in Discord: **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**.

## How it works

- Runs on `x.com` and `twitter.com`.
- Adds a **Discord** button to each visible post’s action bar.
- Scrapes visible post content from the page and enriches media via syndication + intercepted X API responses.
- Sends formatted messages to your chosen Discord webhook.

## Project layout

```
userscript/
  metadata.txt          # Userscript header (name, grants, matches)
  src/
    00-config.js        # Destinations and options — edit this first
    01-http.js          # Webhook / syndication HTTP
    02-utils.js
    03-network-capture.js
    04-video.js
    05-format-discord.js
    06-syndication.js
    07-extract-dom.js
    08-deliver.js
    09-ui.js
dist/
  tweet-discord-share.user.js   # Built file — paste into Violentmonkey
scripts/
  build.mjs
```

## Development

```powershell
npm run build   # writes dist/tweet-discord-share.user.js
npm run check   # build + syntax check
```

## Security

- **Webhook URLs are secrets.** Anyone with your script file or a synced extension backup can post to those channels. Do not commit real webhook URLs to a public repo.
- Keep `DIRECT_DESTINATIONS` empty in git; configure locally after clone or in your private fork.
- Discord webhooks can post as the webhook identity; treat them like passwords.

## Limits

- Scrapes the current X/Twitter page — UI changes can break extraction.
- Private posts only work while visible in your logged-in browser.
- Images share as links in message text; videos are best-effort MP4 URLs when X exposes them.
- Quote posts depend on what X renders in the DOM.

## License

MIT — see [LICENSE](LICENSE).
