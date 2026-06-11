function sanitizeWebhookPayload(payload) {
  const { _messageLabel, ...discordPayload } = payload;
  return discordPayload;
}

async function shareToDestination(destinationId, tweet, options = {}) {
  const destination = await getDestinationById(destinationId);
  if (!destination?.webhookUrl) {
    throw new Error("That destination is missing a webhook URL.");
  }

  const preferences = options.preferences || DEFAULT_PREFERENCES;
  const attachMedia = preferences.attachMedia === true || options.attachMedia === true;
  let payloads;
  let attachments = [];
  let skippedSummary = "";

  if (attachMedia) {
    const resolved = await resolveAttachmentsForTweet(tweet, options);
    attachments = resolved.attachments;
    if (attachments.length > 0) {
      skippedSummary = summarizeSkippedMedia(resolved.skipped);
      payloads = buildDiscordPayloads(tweet, {
        ...options,
        attachMedia: true,
        attachmentUrls: resolved.urls
      });
    } else {
      payloads = buildDiscordPayloads(tweet, { ...options, attachMedia: false });
      showToast("Media upload failed; sent links instead.", "info");
    }
  } else {
    payloads = buildDiscordPayloads(tweet, options);
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

  if (attachMedia && attachments.length > 0 && skippedSummary) {
    showToast(`Uploaded ${attachments.length} file${attachments.length === 1 ? "" : "s"}; ${skippedSummary}.`, "info");
  }
}
