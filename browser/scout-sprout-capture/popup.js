/* global chrome */

const statusNode = document.getElementById("status");

function captureVisibleRole() {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname !== "usesprout.com" && !hostname.endsWith(".usesprout.com")) {
    return { error: "Open a Sprout opportunity before using Scout Capture." };
  }

  let posting = null;
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(node.textContent || "null");
      const candidates = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      posting = candidates.find((item) => item?.["@type"] === "JobPosting") ?? posting;
    } catch { /* Ignore malformed page-owned metadata. */ }
  }

  const pageTitle = document.querySelector('meta[property="og:title"]')?.content || document.title || "";
  const title = String(posting?.title || pageTitle.split(/\s+(?:at|@|\|)\s+/i)[0] || "").trim().slice(0, 300);
  const organization = posting?.hiringOrganization;
  const company = String((typeof organization === "object" ? organization?.name : organization) || pageTitle.split(/\s+(?:at|@|\|)\s+/i)[1] || "").trim().slice(0, 200);
  if (!title || !company) return { error: "Scout could not identify both company and role from the visible page." };
  return { leadUrl: window.location.href, title, company };
}

async function run() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab is available.");
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureVisibleRole });
    const capture = result?.result;
    if (!capture || capture.error) throw new Error(capture?.error || "Unable to read the visible page.");
    const target = new URL("http://127.0.0.1:3000/external-leads");
    target.searchParams.set("capture", "sprout");
    target.searchParams.set("leadUrl", capture.leadUrl);
    target.searchParams.set("company", capture.company);
    target.searchParams.set("title", capture.title);
    await chrome.tabs.create({ url: target.href });
    window.close();
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : "Capture failed safely.";
  }
}

void run();
