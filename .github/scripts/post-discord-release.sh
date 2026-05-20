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
REPO_NAME="${REPO##*/}"

payload=$(jq -cn \
  --arg title "${REPO_NAME} · ${TAG}" \
  --arg url "$RELEASE_URL" \
  --arg repo "$REPO_NAME" \
  '{
    embeds: [{
      title: $title,
      url: $url,
      description: "Install the attached file in Violentmonkey.",
      color: (if $repo == "tweet-share" then 1942002
              elif $repo == "case-clicker" then 15844367
              else 5814783 end)
    }]
  }')

curl -sS -f \
  -F "payload_json=$payload" \
  -F "files[0]=@${ASSET_PATH};filename=${ASSET_NAME}" \
  "$WEBHOOK_URL"
