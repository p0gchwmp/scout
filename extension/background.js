/* global chrome */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ scoutVersion: "0.1.0" });
});
