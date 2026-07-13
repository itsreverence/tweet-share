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

  const payloads = buildDiscordPayloads(tweet, options);

  for (let index = 0; index < payloads.length; index += 1) {
    await request("POST", destination.webhookUrl, sanitizeWebhookPayload(payloads[index]));
    if (index < payloads.length - 1) {
      await delay(WEBHOOK_SEND_DELAY_MS);
    }
  }
}
