function sanitizeWebhookPayload(payload) {
  const { _messageLabel, ...discordPayload } = payload;
  return discordPayload;
}

async function shareToDestination(destinationId, tweet, options = {}) {
  const destination = await getDestinationById(destinationId);
  if (!destination?.webhookUrl) {
    throw new Error("That destination is missing a webhook URL.");
  }

  const payloads = buildDiscordPayloads(tweet, options);
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = sanitizeWebhookPayload(payloads[index]);
    await request("POST", destination.webhookUrl, payload);
    if (index < payloads.length - 1) {
      await delay(WEBHOOK_SEND_DELAY_MS);
    }
  }
}
