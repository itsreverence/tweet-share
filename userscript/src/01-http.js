function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const xhr = typeof GM !== "undefined" && GM.xmlHttpRequest ? GM.xmlHttpRequest : GM_xmlhttpRequest;
    xhr({
      method,
      url,
      headers: { "content-type": "application/json" },
      data: body ? JSON.stringify(body) : undefined,
      onload(response) {
        const text = response.responseText || "{}";
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text };
        }

        if (response.status >= 200 && response.status < 300) {
          resolve(json);
        } else {
          const detail = json.message || json.error || text.slice(0, 200);
          reject(new Error(detail || `Discord webhook returned ${response.status}`));
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
