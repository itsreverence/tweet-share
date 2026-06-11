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

function requestMultipart(url, payloadJson, files = []) {
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
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
