# Tweet Discord Share Userscript

Share X/Twitter posts into Discord with the visible post text, media, and quote-post context. This is a Tampermonkey/Violentmonkey userscript for personal use. It does not require the X API or a running server.

## How It Works

- `userscript/tweet-discord-share.user.js` runs on `x.com` and `twitter.com`.
- It adds a `Discord` button to each visible post.
- It scrapes the visible post content from the page.
- It posts directly to the Discord webhook destination you choose.

## Setup

1. Install Tampermonkey or Violentmonkey.
2. Edit `userscript/tweet-discord-share.user.js`.
3. Add your Discord channels to `DIRECT_DESTINATIONS`:

```js
const DIRECT_DESTINATIONS = [
  {
    id: "friends",
    label: "Friends server - tweets",
    webhookUrl: "https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN"
  },
  {
    id: "personal",
    label: "Personal server - links",
    webhookUrl: "https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN"
  }
];
```

4. Add `userscript/tweet-discord-share.user.js` as a new userscript.
5. Open X/Twitter and use the `Discord` button on a post.

## Discord Webhooks

Create webhooks from Discord channel settings:

`Edit Channel` -> `Integrations` -> `Webhooks` -> `New Webhook` -> `Copy Webhook URL`

Add each webhook to `DIRECT_DESTINATIONS` in the userscript.

## Notes And Limits

- This scrapes the current X/Twitter page, so X UI changes can break extraction.
- Private/protected posts only work while you can see them in your logged-in browser.
- Images usually share as Discord embed images. Videos are best-effort links because X often serves them through dynamic blob/media URLs.
- Quote posts are extracted from what is visible in the page. If X only renders a minimal quote preview, only that visible context can be shared.
- Webhook URLs are visible to anyone who can read your configured userscript or exported browser extension data.

## Development

Run syntax checks:

```powershell
node --check userscript/tweet-discord-share.user.js
```
