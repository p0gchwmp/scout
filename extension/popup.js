/* global chrome */
const status = document.querySelector("#status");
const button = document.querySelector("#fill");

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
}

async function send(type) {
  const tab = await activeTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type });
  } catch {
    // activeTab grants this one user-clicked page only. This is how Scout supports
    // Tally custom domains / direct company forms without requesting <all_urls>.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tab.id, { type });
  }
}

send("SCOUT_INSPECT").then((result) => {
  if (!result?.supported) {
    status.textContent = "This page is not a recognized or Scout-approved application form.";
    button.disabled = true;
    return;
  }
  status.textContent = result.taskReady
    ? `${result.fields} form fields found on ${result.platform}. Scout can fill verified answers only.`
    : `${result.fields} form fields found on ${result.platform}. Open this application from Scout first to create an approved task.`;
  button.disabled = !result.taskReady;
}).catch(() => {
  status.textContent = "Scout could not inspect this page.";
  button.disabled = true;
});

button.addEventListener("click", async () => {
  const result = await send("SCOUT_FILL");
  if (result?.blockers?.length) {
    status.classList.add("blocked");
    status.textContent = `Paused: ${result.blockers.join(" · ")}`;
  } else status.textContent = `${result?.filled ?? 0} verified fields filled. Review the whole form and submit manually.`;
});
