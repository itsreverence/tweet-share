// Keep this free of posts, names, and channels: people paste it into public issues.
function diagnosticsReport() {
  const info = typeof GM_info === "undefined" ? {} : GM_info;
  const captured = [...TWEET_CACHE.values()];
  return [
    `Script: ${info.script?.version || "unknown"}`,
    `Manager: ${info.scriptHandler || "unknown"} ${info.version || ""}`.trimEnd(),
    `Injection: ${info.injectInto || "unknown"}`,
    `Browser: ${navigator.userAgent}`,
    `Capture: ${captureStatus.state}`,
    `X responses read: ${captureStatus.responsesRead}`,
    `Posts captured: ${captured.length} (${captured.filter((post) => post.fullText).length} with full text)`
  ].join("\n");
}

async function copyDiagnostics() {
  const report = diagnosticsReport();
  try {
    await navigator.clipboard.writeText(report);
    showToast("Diagnostics copied. They hold no posts, names, or webhooks.", "success");
  } catch {
    window.prompt("Copy these diagnostics:", report);
  }
}
