// Capture-only service worker: right-click selected text → POST to the clip inbox.
const DEFAULT_ENDPOINT = "http://localhost:3000/api/clips";
const MENU_ID = "add-to-vocab-wiki";

async function getEndpoint() {
  const { endpoint } = await chrome.storage.local.get("endpoint");
  return endpoint || DEFAULT_ENDPOINT;
}

async function postClip({ text, url, title }) {
  const endpoint = await getEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, url, title }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Add “%s” to Vocab Wiki',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  try {
    await postClip({
      text: info.selectionText,
      url: tab?.url ?? info.pageUrl ?? "",
      title: tab?.title ?? "",
    });
    await flashBadge("✓", "#16a34a");
  } catch (err) {
    console.error("clip failed", err);
    await flashBadge("!", "#dc2626");
  }
});

// Let the popup delegate its "clip selection" action to the worker.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "clip") return;
  postClip(msg.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // async response
});
