# Architecture

Tweet Discord Share is a dependency-free userscript assembled from ordered JavaScript modules.

## Build shape

- `userscript/metadata.txt` contains the userscript metadata template.
- `userscript/src/*.js` contains runtime modules. Numeric filename prefixes define concatenation order.
- `scripts/build.mjs` reads the version from `package.json`, injects it into the metadata header, concatenates source modules, and writes `dist/tweet-discord-share.user.js`.
- GitHub Releases publishes the generated userscript and `checksums.txt`.

`dist/` is tracked so the source tree and released artifact can be compared. CI rebuilds it and fails if the result differs.

## Runtime flow

1. Network-capture and DOM helpers observe post data already available to the signed-in browser session.
2. Extraction modules normalize text, author, quote, image, and video details.
3. Formatting modules build Discord webhook payloads within Discord message/embed limits.
4. The X share-menu integration opens a destination picker and optional preview.
5. Delivery sends the chosen payload directly from the browser to the selected Discord webhook.

There is no project-operated server, X API credential, analytics service, or remote settings store.

## Local state and trust boundaries

Discord webhook destinations and preferences live in userscript-manager storage. Webhooks are credentials and must never be logged, committed, included in fixtures, or pasted into issues.

The script may process private/protected posts only when the current browser session can already view them. That capability is not permission to redistribute the content; users remain responsible for access and sharing rules.

## External dependencies

At runtime the userscript may connect only to the hosts declared in its metadata, currently Discord webhooks and X/Twitter syndication media endpoints. Changes to `@grant`, `@connect`, storage, network requests, or release publishing deserve explicit security review.
