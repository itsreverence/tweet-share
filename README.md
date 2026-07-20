# Tweet Discord Share

[![Latest release](https://img.shields.io/github/v/release/itsreverence/tweet-share?label=release)](https://github.com/itsreverence/tweet-share/releases/latest)
[![CI](https://github.com/itsreverence/tweet-share/actions/workflows/ci.yml/badge.svg)](https://github.com/itsreverence/tweet-share/actions/workflows/ci.yml)

A [Tampermonkey](https://www.tampermonkey.net/) / [Violentmonkey](https://violentmonkey.github.io/) userscript that shares X/Twitter posts to Discord webhooks. No X API or server is required—it runs locally in your browser on `x.com` and `twitter.com`.

> This is an unofficial personal sharing helper. It is not affiliated with, endorsed by, or supported by X/Twitter or Discord. Share only posts you may view and redistribute, and follow the rules of the services and communities you use.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the latest [`tweet-discord-share.user.js`](https://github.com/itsreverence/tweet-share/releases/latest/download/tweet-discord-share.user.js) release asset.
3. Review the script when your userscript manager opens its install/update screen, then install it.

If the direct link does not open your userscript manager, download the same `.user.js` file from the [latest release](https://github.com/itsreverence/tweet-share/releases/latest) and import or paste it into a new userscript manually.

## First share

1. In Discord, open **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook**, then copy its URL.
2. On X, open the userscript-manager menu → **Tweet Discord Share settings…**. Selecting **Share** → **Share to Discord** on a post also opens settings when no channels exist.
3. Add a display name, paste the webhook URL, select **Test webhook**, then **Save**.
4. On a post, select **Share** → **Share to Discord** → your destination.

Destinations live in userscript-manager storage on your machine, not in this repository. **Treat webhook URLs like passwords:** anyone with one can post to that Discord channel. Settings masks webhook URLs by default.

## What it shares

- Post text, permalink, author, and timestamp
- Images and native video attachments when eligible
- Quoted posts, with a choice to include or omit the quote
- Only content available to the signed-in browser session

Media upload is automatic and bounded. If a video is unavailable or too large to upload, the share includes one direct playable video link instead.

## Compatibility

- Current Chrome- and Firefox-family browsers
- Current Tampermonkey and Violentmonkey releases
- `x.com` and legacy `twitter.com` URLs

X changes its site frequently, so extraction can temporarily break even when the script itself has not changed. Greasemonkey and Safari are not currently tested.

## Troubleshooting

- **No Share to Discord item:** confirm the userscript is enabled for `x.com`, then reload the page.
- **Webhook test fails:** create a fresh Discord webhook, confirm its URL begins with `https://discord.com/api/webhooks/`, and check whether the channel still exists.
- **Missing media or quote details:** open the post directly and retry. X may not expose every media variant in every timeline view.
- **Install link downloads instead of opening:** import the downloaded `.user.js` through your userscript manager.

If the problem continues, follow [SUPPORT.md](SUPPORT.md) and submit a sanitized bug report. Never include a live webhook URL, cookies, session details, or private post content.

## Responsible use

Do not use this project to bypass access controls, scrape content you cannot normally view, bulk-export posts, harass people, spam Discord channels, or redistribute private/protected content without permission. X/Twitter, Discord, and individual server owners may apply additional restrictions; you are responsible for following them.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, and pull-request guidance. The short version is:

```bash
npm test
npm run check
```

Edit `userscript/src/`; `npm run build` regenerates `dist/tweet-discord-share.user.js`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the build and runtime shape.

## Security and support

This project stores Discord webhook URLs in userscript-manager local storage and sends only the selected post content/media to the destination you choose.

- Vulnerabilities: [SECURITY.md](SECURITY.md)
- Usage help and bug reports: [SUPPORT.md](SUPPORT.md)
- Releases: [GitHub Releases](https://github.com/itsreverence/tweet-share/releases)

## License

MIT—see [LICENSE](LICENSE).
