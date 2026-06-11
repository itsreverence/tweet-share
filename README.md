# Tweet Discord Share

[Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) userscript that shares X/Twitter posts to Discord via webhooks. No X API or server required — it runs locally in your browser on `x.com` / `twitter.com`.

This is an unofficial personal sharing helper. It is not affiliated with, endorsed by, or supported by X/Twitter or Discord. Use it only for posts you are allowed to view and share, and follow the rules of the services and communities you use it with.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the latest userscript release asset:
   [`tweet-discord-share.user.js`](https://github.com/itsreverence/tweet-share/releases/latest/download/tweet-discord-share.user.js)
3. Your userscript manager should open an install/update screen. Review the script, then install it.
4. On X, open **Share** on a post → **Share to Discord**.

If the direct install link does not open your userscript manager, download the same `.user.js` file from the [latest release](https://github.com/itsreverence/tweet-share/releases/latest), then paste it into a new userscript manually.

## Discord channels

1. Tampermonkey/Violentmonkey menu → **Tweet Discord Share** → **Discord channels…**, or
   **Share** → **Manage channels…** on a post.
2. Add a name and webhook URL, then **Save**.

Create a webhook in Discord: **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook** → copy the URL.

Channels live in userscript-manager storage on your machine, not in this repo. **Treat webhook URLs like passwords** — anyone with the URL can post to that Discord channel.

## What it does

- Adds **Share to Discord** to X’s native **Share** menu
- Sends post text, permalink, timestamps, images, and video links/attachments where available
- Supports quoted posts and lets you choose whether to include the quote when sharing
- Scrapes what’s visible on the page; private/protected posts only work while you can see them

## Responsible use

- This project is unofficial and may stop working if X/Twitter changes its website or policies.
- Do not use it to bypass access controls, scrape content you cannot normally view, bulk-export posts, harass people, spam Discord channels, or repost private/protected content without permission.
- The script can send selected post text/media and Discord webhook URLs through your browser/userscript manager. Review what you share and keep webhook URLs private.
- X/Twitter, Discord, or a Discord server owner may restrict content sharing or automated tooling differently. You are responsible for using the script within those rules.

## Development

```bash
npm test
npm run build   # writes dist/tweet-discord-share.user.js
npm run check   # build + syntax check
```

Edit `userscript/src/`; `npm run build` updates `dist/`.

**Releases:** bump `package.json` `version`, push to `master`, and GitHub Actions publishes `v{version}` as Latest after tests, build, and syntax check pass. The userscript metadata version is injected from `package.json` during build.

## Security and support

This project stores Discord webhook URLs in your userscript manager’s local storage and sends selected post content/media to the webhook you choose. Do not share webhook URLs publicly, commit them to git, or paste them into bug reports.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and support boundaries.

## License

MIT — see [LICENSE](LICENSE).
