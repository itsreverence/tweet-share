function xhrClient() {
  return typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest : GM_xmlhttpRequest;
}

function parseDiscordResponse(response) {
  const text = response.responseText || "{}";
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (response.status >= 200 && response.status < 300) {
    return json;
  }

  const detail = json.message || json.error || text.slice(0, 200);
  throw new Error(detail || `Discord webhook returned ${response.status}`);
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    xhrClient()({
      method,
      url,
      headers: { "content-type": "application/json" },
      data: body ? JSON.stringify(body) : undefined,
      onload(response) {
        try {
          resolve(parseDiscordResponse(response));
        } catch (error) {
          reject(error);
        }
      },
      onerror() {
        reject(new Error("Could not reach Discord. Check your network and webhook URL."));
      }
    });
  });
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    xhrClient()({
      method: "GET",
      url,
      responseType: "arraybuffer",
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          resolve(response.response);
          return;
        }
        reject(new Error(`Could not download media (${response.status}).`));
      },
      onerror() {
        reject(new Error("Could not download media. Check your network."));
      }
    });
  });
}

function requestWebhookMultipart(webhookUrl, payload, files) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => {
      const blob = new Blob([file.data], { type: file.type || "video/mp4" });
      form.append(`files[${index}]`, blob, file.filename);
    });

    xhrClient()({
      method: "POST",
      url: webhookUrl,
      data: form,
      onload(response) {
        try {
          resolve(parseDiscordResponse(response));
        } catch (error) {
          reject(error);
        }
      },
      onerror() {
        reject(new Error("Could not reach Discord. Check your network and webhook URL."));
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
