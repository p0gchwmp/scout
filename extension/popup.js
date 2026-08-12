/* global chrome */
const status = document.querySelector("#status");
const button = document.querySelector("#fill");

async function send(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: "No active tab" };
  return chrome.tabs.sendMessage(tab.id, { type });
}

send("SCOUT_INSPECT").then((result) => {
  status.textContent = result?.supported ? `${result.fields} form fields found on an allowlisted portal.` : "This portal is not supported yet. Scout will leave it manual.";
  button.disabled = !result?.supported;
});

button.addEventListener("click", async () => {
  const result = await send("SCOUT_FILL");
  if (result?.blockers?.length) {
    status.classList.add("blocked");
    status.textContent = `Paused: ${result.blockers.join(" · ")}`;
  } else status.textContent = `${result?.filled ?? 0} verified fields filled. Review before submission.`;
});
