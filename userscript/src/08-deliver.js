function sanitizeWebhookPayload(payload) {
  const { _messageLabel, _files, ...discordPayload } = payload;
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
    attachments: attachments.map(({ filename, sourceUrl }) => ({ filename, sourceUrl })),
    fallbackVideoUrls
  });
  const messages = payloads.map((payload) => ({
    payload: sanitizeWebhookPayload(payload),
    files: attachments.filter((attachment) => payload._files?.includes(attachment.filename))
  }));
  const uploadedCount = messages.reduce((count, message) => count + message.files.length, 0);

  if (resolved.skipped.length > 0 && attachments.length === 0) {
    const skippedSummary = summarizeSkippedMedia(resolved.skipped);
    showToast(`Media could not upload (${skippedSummary}); sent available fallback content.`, "info");
  }

  for (let index = 0; index < messages.length; index += 1) {
    const { payload, files } = messages[index];
    try {
      if (files.length > 0) {
        await requestMultipart(
          destination.webhookUrl,
          payload,
          files.map((attachment, fileIndex) => ({
            name: `files[${fileIndex}]`,
            filename: attachment.filename,
            bytes: attachment.bytes,
            contentType: attachment.contentType
          }))
        );
      } else {
        await request("POST", destination.webhookUrl, payload);
      }
    } catch (error) {
      if (index === 0) throw error;
      throw new Error(
        `Sent ${index} of ${messages.length} Discord messages before delivery failed: ${error.message}`,
        { cause: error }
      );
    }
    if (index < messages.length - 1) {
      await delay(WEBHOOK_SEND_DELAY_MS);
    }
  }

  if (uploadedCount > 0 && resolved.skipped.length > 0) {
    const skippedSummary = summarizeSkippedMedia(resolved.skipped);
    showToast(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}; ${skippedSummary}.`, "info");
  }
}
