#!/usr/bin/env bash
set -euo pipefail

if [ -z "${WEBHOOK_URL:-}" ]; then
  echo "DISCORD_RELEASE_WEBHOOK secret is not configured"
  exit 1
fi

: "${REPO:?REPO is required}"
: "${TAG:?TAG is required}"
: "${ASSET_PATH:?ASSET_PATH is required}"
: "${ASSET_NAME:?ASSET_NAME is required}"

if [ ! -f "$ASSET_PATH" ]; then
  echo "Asset not found: $ASSET_PATH"
  exit 1
fi

RELEASE_URL="${RELEASE_URL:-$(gh release view "$TAG" --repo "$REPO" --json url -q .url)}"
PUBLISHED_AT="${PUBLISHED_AT:-$(gh release view "$TAG" --repo "$REPO" --json publishedAt -q .publishedAt)}"
IS_PRERELEASE="${IS_PRERELEASE:-$(gh release view "$TAG" --repo "$REPO" --json isPrerelease -q .isPrerelease)}"

payload=$(jq -cn \
  --arg repo "$REPO" \
  --arg tag "$TAG" \
  --arg release "$RELEASE_URL" \
  --arg published "$PUBLISHED_AT" \
  --arg prerelease "$IS_PRERELEASE" \
  '
    ($repo | split("/")) as $parts |
    ($parts[0]) as $owner |
    ($parts[1]) as $name |
    ($name + " · " + $tag) as $title |
    (if $prerelease == "true" then "Prerelease" else "Stable release" end) as $channel |
    (if $name == "tweet-share" then 1942002
     elif $name == "case-clicker" then 15844367
     else 5814783 end) as $color |
    {
      embeds: [{
        title: $title,
        url: $release,
        description: "Install the attached **.user.js** in Tampermonkey or Violentmonkey.",
        color: $color,
        fields: [
          {
            name: "Channel",
            value: $channel,
            inline: true
          }
        ],
        footer: { text: ("GitHub · " + $owner) },
        timestamp: $published
      }]
    }
  ')

curl -sS -f \
  -F "payload_json=$payload" \
  -F "files[0]=@${ASSET_PATH};filename=${ASSET_NAME}" \
  "$WEBHOOK_URL"
