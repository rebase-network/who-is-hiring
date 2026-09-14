const HIRE_URL = /^https:\/\/hire\.rebase\.network\//;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !HIRE_URL.test(tab.url || "")) {
    return;
  }

  const { preferences } = await chrome.storage.local.get("preferences");
  if (!preferences?.filterActive) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "RHF_FILTER",
      query: preferences.query || ""
    });
  } catch {
    // The manifest content script may still be starting; it also restores
    // persisted filters on its own once the page is ready.
  }
});
