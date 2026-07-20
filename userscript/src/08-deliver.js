function sanitizeWebhookPayload(payload) {
  const { _messageLabel, ...discordPayload } = payload;
  return discordPayload;
}

function buildWebhookTestPayload() {
  return {
    username: webhookSenderName(),
    avatar_url: webhookSenderAvatarUrl(),
    content: "Tweet Discord Share connected — this channel is ready to receive shares."
  };
}

async function sendWebhookTest(webhookUrl) {
  const url = String(webhookUrl || "").trim();
  if (!isValidWebhookUrl(url)) {
    throw new Error("Enter a valid Discord webhook URL.");
  }
  await request("POST", url, buildWebhookTestPayload());
}

async function shareToDestination(destinationId, tweet, options = {}) {
  const destination = await getDestinationById(destinationId);
  if (!destination?.webhookUrl) {
    throw new Error("That destination is missing a webhook URL.");
  }

  const resolved = await resolveAttachmentsForTweet(tweet, options);
  const attachments = resolved.attachments;
  const fallbackVideoUrls = resolved.skipped
    .map((item) => item.sourceUrl)
    .filter((url) => isPlayableTweetVideoUrl(url));
  const payloads = buildDiscordPayloads(tweet, {
    ...options,
    attachMedia: attachments.length > 0,
    attachmentUrls: resolved.urls,
    fallbackVideoUrls
  });

  if (resolved.skipped.length > 0 && attachments.length === 0) {
    showToast("Media could not upload; sent available fallback content.", "info");
  }

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = sanitizeWebhookPayload(payloads[index]);
    if (index === 0 && attachments.length > 0) {
      await requestMultipart(
        destination.webhookUrl,
        payload,
        attachments.map((attachment, fileIndex) => ({
          name: `files[${fileIndex}]`,
          filename: attachment.filename,
          bytes: attachment.bytes,
          contentType: attachment.contentType
        }))
      );
    } else {
      await request("POST", destination.webhookUrl, payload);
    }
    if (index < payloads.length - 1) {
      await delay(WEBHOOK_SEND_DELAY_MS);
    }
  }

  if (attachments.length > 0 && resolved.skipped.length > 0) {
    const skippedSummary = summarizeSkippedMedia(resolved.skipped);
    showToast(`Uploaded ${attachments.length} file${attachments.length === 1 ? "" : "s"}; ${skippedSummary}.`, "info");
  }
}
