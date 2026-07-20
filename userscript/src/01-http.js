function xhrClient() {
  return typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest : GM_xmlhttpRequest;
}

const HTTP_TIMEOUT_MS = 15_000;
const HTTP_MAX_RATE_LIMIT_RETRIES = 2;
const HTTP_DEFAULT_RETRY_DELAY_MS = 1_000;
const HTTP_MAX_RETRY_DELAY_MS = 10_000;

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
  const error = new Error(detail || `Request returned ${response.status}`);
  error.status = response.status;
  const retryAfterSeconds = Number(json.retry_after);
  if (response.status === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    error.retryAfterMs = Math.ceil(retryAfterSeconds * 1000);
  }
  throw error;
}

function boundedRetryDelay(error) {
  const requested = Number(error?.retryAfterMs);
  const delayMs = Number.isFinite(requested) && requested >= 0 ? requested : HTTP_DEFAULT_RETRY_DELAY_MS;
  return delayMs <= HTTP_MAX_RETRY_DELAY_MS ? delayMs : null;
}

async function retryRateLimitedRequest(send, maxRetries = HTTP_MAX_RATE_LIMIT_RETRIES) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (error?.status !== 429 || attempt >= maxRetries) throw error;
      const retryDelayMs = boundedRetryDelay(error);
      if (retryDelayMs === null) throw error;
      await delay(retryDelayMs);
    }
  }
}

function requestOnce(method, url, body) {
  return new Promise((resolve, reject) => {
    xhrClient()({
      method,
      url,
      timeout: HTTP_TIMEOUT_MS,
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
      },
      ontimeout() {
        reject(new Error("The request timed out. Check your network and try again."));
      }
    });
  });
}

function request(method, url, body) {
  return retryRateLimitedRequest(() => requestOnce(method, url, body));
}

function requestMultipartOnce(url, payloadJson, files = []) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payloadJson || {}));
    files.forEach((file, index) => {
      const blob = file.blob || new Blob([file.bytes], { type: file.contentType || "application/octet-stream" });
      formData.append(file.name || `files[${index}]`, blob, file.filename || `media_${index}`);
    });

    xhrClient()({
      method: "POST",
      url,
      timeout: HTTP_TIMEOUT_MS,
      data: formData,
      onload(response) {
        try {
          resolve(parseDiscordResponse(response));
        } catch (error) {
          reject(error);
        }
      },
      onerror() {
        reject(new Error("Could not reach Discord. Check your network and webhook URL."));
      },
      ontimeout() {
        reject(new Error("The request timed out. Check your network and try again."));
      }
    });
  });
}

function requestMultipart(url, payloadJson, files = []) {
  return retryRateLimitedRequest(() => requestMultipartOnce(url, payloadJson, files));
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
