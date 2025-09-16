// background.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("Page Compare Pro has been installed.");
});

// The service worker is intentionally left minimal.
// All logic is now handled by the content script and popup.