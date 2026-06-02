function isVideoAttachmentPayload(payload) {
  return Array.isArray(payload?._videoAttachments) && payload._videoAttachments.length > 0;
}

async function sendVideoAttachmentPayload(webhookUrl, payload) {
  const discordPayload = {
    username: payload.username,
    avatar_url: payload.avatar_url,
    allowed_mentions: payload.allowed_mentions
  };

  const files = await Promise.all(
    payload._videoAttachments.map(async (item) => ({
      filename: item.filename,
      type: "video/mp4",
      data: await fetchBinary(item.url)
    }))
  );

  await requestWebhookMultipart(webhookUrl, discordPayload, files);
}

async function sendVideoUrlFallback(webhookUrl, payload) {
  const urls = payload._videoAttachments.map((item) => item.url).join("\n");
  await request("POST", webhookUrl, {
    username: payload.username,
    avatar_url: payload.avatar_url,
    content: truncate(urls, DISCORD_LIMITS.content),
    allowed_mentions: { parse: [] }
  });
}

async function shareToDestination(destinationId, tweet, options = {}) {
  const destination = await getDestinationById(destinationId);
  if (!destination?.webhookUrl) {
    throw new Error("That destination is missing a webhook URL.");
  }

  const payloads = buildDiscordPayloads(tweet, options);
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    if (isVideoAttachmentPayload(payload)) {
      try {
        await sendVideoAttachmentPayload(destination.webhookUrl, payload);
      } catch (error) {
        console.warn("Tweet Share: video upload failed, sending URLs only", error);
        await sendVideoUrlFallback(destination.webhookUrl, payload);
      }
    } else {
      await request("POST", destination.webhookUrl, payload);
    }
    if (index < payloads.length - 1) {
      await delay(WEBHOOK_SEND_DELAY_MS);
    }
  }
}
