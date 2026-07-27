const DEFAULT_ENDPOINT = "http://localhost:3000/api/clips";
const $ = (id) => document.getElementById(id);

function setStatus(text, ok) {
  const el = $("status");
  el.textContent = text;
  el.style.color = ok === false ? "#dc2626" : ok === true ? "#16a34a" : "#555";
}

// Load saved endpoint.
chrome.storage.local.get("endpoint").then(({ endpoint }) => {
  $("endpoint").value = endpoint || DEFAULT_ENDPOINT;
});
$("endpoint").addEventListener("change", (e) => {
  chrome.storage.local.set({ endpoint: e.target.value.trim() || DEFAULT_ENDPOINT });
});

$("clip").addEventListener("click", async () => {
  setStatus("Reading selection…");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return setStatus("No active tab", false);

  const [{ result: selection } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection()?.toString() ?? "",
  });

  const text = (selection || "").trim();
  if (!text) return setStatus("Select some text first", false);

  chrome.runtime.sendMessage(
    { type: "clip", payload: { text, url: tab.url, title: tab.title } },
    (resp) => {
      if (resp?.ok) setStatus(`Clipped ${resp.data.chars} chars ✓`, true);
      else setStatus(`Failed: ${resp?.error ?? "unknown"}`, false);
    },
  );
});
