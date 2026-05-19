function appendWhenReady(node) {
  if (document.documentElement) {
    document.documentElement.append(node);
    return;
  }

  document.addEventListener("DOMContentLoaded", () => document.documentElement.append(node), { once: true });
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .${BUTTON_CLASS} {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 999px;
      color: rgb(83, 100, 113);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      gap: 6px;
      min-height: 34px;
      padding: 0 10px;
    }
    .${BUTTON_CLASS}:hover {
      background: rgba(29, 155, 240, 0.1);
      color: rgb(29, 155, 240);
    }
    .${BUTTON_CLASS}[disabled] {
      cursor: wait;
      opacity: 0.7;
    }
    .${STATUS_CLASS} {
      color: rgb(83, 100, 113);
      font-size: 13px;
      margin-left: 6px;
    }
    .${STATUS_CLASS}[data-state="success"] {
      color: rgb(0, 186, 124);
    }
    .${STATUS_CLASS}[data-state="error"] {
      color: rgb(244, 33, 46);
    }
  `;
  appendWhenReady(style);
}

function setStatus(container, message, state = "info") {
  let status = container.querySelector(`.${STATUS_CLASS}`);
  if (!status) {
    status = document.createElement("span");
    status.className = STATUS_CLASS;
    container.append(status);
  }
  status.dataset.state = state;
  status.textContent = message;
  window.setTimeout(() => status.remove(), 3500);
}

async function chooseDestination() {
  const destinations = await getDestinations();
  if (destinations.length === 0) {
    throw new Error("No destinations configured. Add webhooks in userscript/src/00-config.js and rebuild.");
  }

  if (destinations.length === 1) {
    return destinations[0].id;
  }

  const last = localStorage.getItem(DESTINATION_KEY);
  const options = destinations
    .map((destination, index) => `${index + 1}. ${destination.label}${destination.id === last ? " (last)" : ""}`)
    .join("\n");
  const answer = window.prompt(`Send this post to which Discord destination?\n\n${options}`, last || "1");
  if (!answer) return "";

  const byNumber = destinations[Number(answer) - 1];
  const byId = destinations.find((destination) => destination.id === answer);
  const destination = byNumber || byId;
  if (!destination) {
    throw new Error("That destination was not found.");
  }

  localStorage.setItem(DESTINATION_KEY, destination.id);
  return destination.id;
}

async function shareTweet(article, button) {
  const actionBar = button.parentElement;
  button.disabled = true;
  setStatus(actionBar, "Preparing...");

  try {
    const destinationId = await chooseDestination();
    if (!destinationId) {
      setStatus(actionBar, "Canceled");
      return;
    }

    const tweet = await enrichTweetMedia(extractTweet(article));
    if (DEBUG_MEDIA_EXTRACTION) {
      console.group("Tweet Discord Share media debug");
      console.log(tweet);
      console.log("Detected direct video URLs", directVideoUrlsFromDocument());
      console.log("Cached video variants", Object.fromEntries(VIDEO_VARIANT_CACHE));
      console.groupEnd();
    }
    await shareToDestination(destinationId, tweet);
    setStatus(actionBar, "Sent", "success");
  } catch (error) {
    console.error(error);
    setStatus(actionBar, error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function makeButton(article) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.title = "Share to Discord";
  button.setAttribute("aria-label", "Share to Discord");
  button.innerHTML = `<span aria-hidden="true">Discord</span>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    shareTweet(article, button);
  });
  return button;
}

function enhanceArticle(article) {
  if (article.querySelector(`.${BUTTON_CLASS}`)) return;

  const actionBar = article.querySelector('[role="group"]');
  if (!actionBar) return;

  actionBar.append(makeButton(article));
}

function enhanceTimeline() {
  document.querySelectorAll("article").forEach(enhanceArticle);
}

function startUi() {
  injectStyles();
  installNetworkCapture();
  enhanceTimeline();
  const observer = new MutationObserver(enhanceTimeline);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

startUi();
