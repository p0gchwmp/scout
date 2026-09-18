/* global chrome */
const status = document.querySelector("#status");
const fillButton = document.querySelector("#fill");
const loadButton = document.querySelector("#load-task");
const scoutUrlInput = document.querySelector("#scout-url");
const handoffInput = document.querySelector("#handoff");
const intelligence = document.querySelector("#intelligence");
const counts = document.querySelector("#counts");
const constraintReview = document.querySelector("#constraint-review");
const constraintList = document.querySelector("#constraint-list");
const acknowledgeConstraintsButton = document.querySelector("#ack-constraints");
const answerReview = document.querySelector("#answer-review");
const reviewList = document.querySelector("#review-list");
const DEFAULT_SCOUT_BASE_URL = "https://ryan-scout-e3a2eb4fdd1a.herokuapp.com";

function normalizeScoutBaseUrl(raw) {
  const url = new URL(raw.trim());
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Scout URL must be an HTTPS origin, or localhost during development.");
  }
  return url.origin;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active application tab");
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

function renderIntelligence(summary) {
  if (!summary || !Number.isFinite(summary.total)) {
    intelligence.hidden = true;
    counts.textContent = "";
    return;
  }
  const items = [
    [summary.safeAutofill ?? 0, "Safe autofill", "safe"],
    [summary.claimDrafts ?? 0, "Claim drafts", "draft"],
    [summary.needsUser ?? 0, "Needs your answer", "manual"],
    [(summary.sensitiveManual ?? 0) + (summary.unsupportedManual ?? 0), "Sensitive / manual", "manual"],
  ];
  counts.replaceChildren(...items.map(([number, label, className]) => {
    const card = document.createElement("div");
    card.className = `count ${className}`;
    const strong = document.createElement("strong");
    strong.textContent = String(number);
    card.append(strong, document.createTextNode(String(label)));
    return card;
  }));
  intelligence.hidden = false;
}

function fieldMetadata(inspection) {
  const fields = inspection?.formIntelligence?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => ({
    id: field.id,
    label: field.label,
    controlKind: field.controlKind,
    inputType: field.inputType,
    maxLength: field.maxLength,
    required: field.required === true,
  }));
}

function reviewMatchesTask(review, task) {
  return Boolean(
    review && task
    && review.schemaVersion === 1
    && review.applicationId === task.applicationId
    && review.artifactVersion === task.artifactVersion
    && review.expiresAt === task.expiresAt
    && review.expiresAt > Date.now()
    && Array.isArray(review.drafts)
  );
}

function constraintReviewMatchesTask(review, task) {
  return Boolean(
    review && task
    && review.schemaVersion === 1
    && review.applicationId === task.applicationId
    && review.artifactVersion === task.artifactVersion
    && review.expiresAt === task.expiresAt
    && review.expiresAt > Date.now()
    && Array.isArray(review.constraints)
  );
}

function constraintAcknowledgementMatchesTask(acknowledgement, task) {
  return Boolean(
    acknowledgement && task
    && acknowledgement.schemaVersion === 1
    && acknowledgement.applicationId === task.applicationId
    && acknowledgement.artifactVersion === task.artifactVersion
    && acknowledgement.expiresAt === task.expiresAt
    && acknowledgement.expiresAt > Date.now()
    && Number.isFinite(acknowledgement.acknowledgedAt)
  );
}

function renderConstraintReview(review, task, acknowledgement) {
  if (!constraintReviewMatchesTask(review, task) || !review.constraints.length) {
    constraintReview.hidden = true;
    constraintList.textContent = "";
    acknowledgeConstraintsButton.disabled = false;
    return;
  }
  const acknowledged = constraintAcknowledgementMatchesTask(acknowledgement, task);
  const cards = review.constraints.map((item) => {
    const card = document.createElement("div");
    card.className = "constraint-item";
    const heading = document.createElement("strong");
    heading.textContent = item.label;
    const meta = document.createElement("span");
    meta.textContent = `${String(item.kind || "review").replaceAll("_", " ")}${item.required ? " · required" : ""} — ${item.reason || "Review this question manually."}`;
    card.append(heading, meta);
    return card;
  });
  constraintList.replaceChildren(...cards);
  acknowledgeConstraintsButton.disabled = acknowledged;
  acknowledgeConstraintsButton.textContent = acknowledged ? "Reviewed for this exact task" : "I reviewed these constraints";
  constraintReview.hidden = false;
}

async function constraintReviewBlocksFill(task) {
  const { pendingConstraintReview, constraintReviewAcknowledgement } = await chrome.storage.local.get(["pendingConstraintReview", "constraintReviewAcknowledgement"]);
  return constraintReviewMatchesTask(pendingConstraintReview, task)
    && pendingConstraintReview.constraints.length > 0
    && !constraintAcknowledgementMatchesTask(constraintReviewAcknowledgement, task);
}

function answerSource(questionId) {
  return `ai:${questionId}`;
}

function withoutReviewedAnswer(task, questionId) {
  return {
    ...task,
    answers: (task.answers ?? []).filter((item) => item?.sourceField !== answerSource(questionId)),
  };
}

async function approveDraft(questionId, value) {
  const { approvedTask, pendingAnswerReview } = await chrome.storage.local.get(["approvedTask", "pendingAnswerReview"]);
  if (!reviewMatchesTask(pendingAnswerReview, approvedTask)) throw new Error("This answer review expired. Load a fresh Scout handoff.");
  const draft = pendingAnswerReview.drafts.find((item) => item.questionId === questionId);
  if (!draft) throw new Error("Application answer draft is no longer available");
  const clean = `${value || ""}`.trim();
  if (!clean) throw new Error("Answer cannot be empty");
  if (Number.isInteger(draft.maxLength) && clean.length > draft.maxLength) throw new Error(`Answer exceeds the ${draft.maxLength}-character form limit`);

  const nextTask = withoutReviewedAnswer(approvedTask, questionId);
  nextTask.answers.push({
    key: draft.label.toLowerCase(),
    value: clean,
    verified: false,
    aiDraft: true,
    reviewed: true,
    reviewedAt: Date.now(),
    userEdited: clean !== draft.proposedAnswer,
    sourceField: answerSource(questionId),
    usedClaimIds: [...draft.usedClaimIds],
  });
  const nextReview = {
    ...pendingAnswerReview,
    drafts: pendingAnswerReview.drafts.map((item) => item.questionId === questionId
      ? { ...item, decision: "approved", editedAnswer: clean }
      : item),
  };
  await chrome.storage.local.set({ approvedTask: nextTask, pendingAnswerReview: nextReview });
  renderAnswerReview(nextReview, nextTask);
  status.classList.remove("blocked");
  status.textContent = "Answer approved for this exact application task. It is now eligible for Safe Fill; final submission is still manual.";
}

async function leaveDraftManual(questionId, value) {
  const { approvedTask, pendingAnswerReview } = await chrome.storage.local.get(["approvedTask", "pendingAnswerReview"]);
  if (!reviewMatchesTask(pendingAnswerReview, approvedTask)) throw new Error("This answer review expired. Load a fresh Scout handoff.");
  const nextTask = withoutReviewedAnswer(approvedTask, questionId);
  const nextReview = {
    ...pendingAnswerReview,
    drafts: pendingAnswerReview.drafts.map((item) => item.questionId === questionId
      ? { ...item, decision: "manual", editedAnswer: `${value || item.proposedAnswer}` }
      : item),
  };
  await chrome.storage.local.set({ approvedTask: nextTask, pendingAnswerReview: nextReview });
  renderAnswerReview(nextReview, nextTask);
  status.classList.remove("blocked");
  status.textContent = "That question will stay manual. Scout will not insert an answer for it.";
}

async function revokeDraftApproval(questionId) {
  const { approvedTask, pendingAnswerReview } = await chrome.storage.local.get(["approvedTask", "pendingAnswerReview"]);
  if (!reviewMatchesTask(pendingAnswerReview, approvedTask)) throw new Error("This answer review expired. Load a fresh Scout handoff.");
  const current = pendingAnswerReview.drafts.find((item) => item.questionId === questionId);
  if (!current || current.decision !== "approved") return;
  const nextTask = withoutReviewedAnswer(approvedTask, questionId);
  const nextReview = {
    ...pendingAnswerReview,
    drafts: pendingAnswerReview.drafts.map((item) => item.questionId === questionId
      ? { ...item, decision: "pending" }
      : item),
  };
  await chrome.storage.local.set({ approvedTask: nextTask, pendingAnswerReview: nextReview });
  renderAnswerReview(nextReview, nextTask);
  status.classList.remove("blocked");
  status.textContent = "Approval revoked. Edit the answer, then approve it again if you want Scout to fill it.";
}

function renderAnswerReview(review, task) {
  if (!reviewMatchesTask(review, task) || !review.drafts.length) {
    answerReview.hidden = true;
    reviewList.textContent = "";
    return;
  }

  const cards = review.drafts.map((draft) => {
    const card = document.createElement("article");
    card.className = "review-card";

    const heading = document.createElement("h3");
    heading.textContent = draft.label;

    const badge = document.createElement("span");
    badge.className = `review-state ${draft.decision === "approved" ? "approved" : draft.decision === "manual" ? "manual" : ""}`;
    badge.textContent = draft.decision === "approved" ? "Approved for fill" : draft.decision === "manual" ? "Manual" : "Pending review";

    const textarea = document.createElement("textarea");
    textarea.value = typeof draft.editedAnswer === "string" ? draft.editedAnswer : draft.proposedAnswer;
    textarea.disabled = draft.decision === "approved";
    if (Number.isInteger(draft.maxLength)) textarea.maxLength = draft.maxLength;
    textarea.setAttribute("aria-label", `Review answer for ${draft.label}`);

    const meta = document.createElement("p");
    meta.className = "review-meta";
    const prefix = document.createTextNode("Supporting claim IDs: ");
    const code = document.createElement("code");
    code.textContent = draft.usedClaimIds.join(", ") || "none";
    meta.append(prefix, code);

    const actions = document.createElement("div");
    actions.className = "review-actions";
    const approve = document.createElement("button");
    approve.textContent = draft.decision === "approved" ? "Approved" : "Approve for fill";
    approve.disabled = draft.decision === "approved";
    approve.addEventListener("click", () => {
      void approveDraft(draft.questionId, textarea.value).catch((error) => {
        status.classList.add("blocked");
        status.textContent = error instanceof Error ? error.message : "Unable to approve answer";
      });
    });
    const secondary = document.createElement("button");
    secondary.className = "secondary";
    secondary.textContent = draft.decision === "approved" ? "Revoke / edit" : draft.decision === "manual" ? "Stays manual" : "Leave manual";
    secondary.disabled = draft.decision === "manual";
    secondary.addEventListener("click", () => {
      const action = draft.decision === "approved"
        ? revokeDraftApproval(draft.questionId)
        : leaveDraftManual(draft.questionId, textarea.value);
      void action.catch((error) => {
        status.classList.add("blocked");
        status.textContent = error instanceof Error ? error.message : "Unable to update answer review";
      });
    });
    actions.append(approve, secondary);

    card.append(heading, badge, textarea, meta, actions);
    return card;
  });

  reviewList.replaceChildren(...cards);
  answerReview.hidden = false;
}

async function refreshInspection() {
  const result = await send("SCOUT_INSPECT");
  renderIntelligence(result?.formIntelligence?.summary);
  if (!result?.supported) {
    status.textContent = "This page is not a recognized or Scout-approved application form.";
    fillButton.disabled = true;
    return result;
  }
  status.classList.remove("blocked");
  const total = result.formIntelligence?.summary?.total ?? result.fields ?? 0;
  const { approvedTask } = await chrome.storage.local.get("approvedTask");
  const constraintBlocked = approvedTask ? await constraintReviewBlocksFill(approvedTask) : false;
  status.textContent = constraintBlocked
    ? `${total} visible field(s) found on ${result.platform}. Review the flagged eligibility/schedule questions before Safe Fill.`
    : result.taskReady
      ? `${total} visible field(s) found on ${result.platform}. Scout has an exact-page task ready; only verified profile values and explicitly reviewed text can be filled.`
      : `${total} visible field(s) found on ${result.platform}. Generate a browser handoff in Scout, then load it here.`;
  fillButton.disabled = !result.taskReady || constraintBlocked;
  return result;
}

function scoutOriginPermission(baseUrl) {
  return { origins: [`${new URL(baseUrl).origin}/*`] };
}

async function loadApprovedTask(baseUrl) {
  status.classList.remove("blocked");
  const token = handoffInput.value.trim();
  if (token.length < 40) throw new Error("Paste the handoff token generated by Scout.");
  const tab = await activeTab();
  const inspection = await send("SCOUT_INSPECT");

  const response = await fetch(`${baseUrl}/browser-handoff/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, currentUrl: tab.url, fields: fieldMetadata(inspection) }),
    cache: "no-store",
    credentials: "omit",
  });
  const payload = await response.json();
  if (!response.ok || !payload?.task) throw new Error(payload?.error || "Scout rejected the browser handoff.");

  const pendingAnswerReview = {
    schemaVersion: 1,
    applicationId: payload.task.applicationId,
    artifactVersion: payload.task.artifactVersion,
    expiresAt: payload.task.expiresAt,
    drafts: Array.isArray(payload.answerReview?.drafts)
      ? payload.answerReview.drafts.map((draft) => ({ ...draft, decision: "pending", editedAnswer: draft.proposedAnswer }))
      : [],
  };
  const pendingConstraintReview = {
    schemaVersion: 1,
    applicationId: payload.task.applicationId,
    artifactVersion: payload.task.artifactVersion,
    expiresAt: payload.task.expiresAt,
    constraints: Array.isArray(payload.constraintReview?.constraints) ? payload.constraintReview.constraints : [],
  };
  await chrome.storage.local.remove("constraintReviewAcknowledgement");
  await chrome.storage.local.set({ approvedTask: payload.task, pendingAnswerReview, pendingConstraintReview, scoutBaseUrl: baseUrl });
  handoffInput.value = "";
  renderIntelligence(payload.formIntelligence?.summary);
  renderConstraintReview(pendingConstraintReview, payload.task, null);
  renderAnswerReview(pendingAnswerReview, payload.task);
  const aiCount = pendingAnswerReview.drafts.length;
  const manualCount = payload.manualQuestions?.length ?? 0;
  const constraintCount = pendingConstraintReview.constraints.length;
  const safeCount = payload.formIntelligence?.summary?.safeAutofill ?? 0;
  const aiNote = payload.ai?.error ? ` ${payload.ai.error}.` : "";
  status.textContent = constraintCount
    ? `Task loaded. Review ${constraintCount} eligibility/schedule constraint${constraintCount === 1 ? "" : "s"} before Safe Fill. Scout has not answered those fields.${aiNote}`
    : `Task loaded. ${safeCount} verified profile field(s) are fillable, ${aiCount} claim-backed draft(s) await your approval, and ${manualCount} field(s) stay manual.${aiNote}`;
  fillButton.disabled = constraintCount > 0;
}

acknowledgeConstraintsButton.addEventListener("click", async () => {
  try {
    const { approvedTask, pendingConstraintReview } = await chrome.storage.local.get(["approvedTask", "pendingConstraintReview"]);
    if (!constraintReviewMatchesTask(pendingConstraintReview, approvedTask) || !pendingConstraintReview.constraints.length) {
      throw new Error("This constraint review expired. Load a fresh Scout handoff.");
    }
    const acknowledgement = {
      schemaVersion: 1,
      applicationId: approvedTask.applicationId,
      artifactVersion: approvedTask.artifactVersion,
      expiresAt: approvedTask.expiresAt,
      acknowledgedAt: Date.now(),
    };
    await chrome.storage.local.set({ constraintReviewAcknowledgement: acknowledgement });
    renderConstraintReview(pendingConstraintReview, approvedTask, acknowledgement);
    fillButton.disabled = false;
    status.classList.remove("blocked");
    status.textContent = "Constraint review acknowledged for this exact task. Scout still will not answer those fields; review the full form before manual submit.";
  } catch (error) {
    status.classList.add("blocked");
    status.textContent = error instanceof Error ? error.message : "Unable to acknowledge constraint review";
  }
});

chrome.storage.local.get(["scoutBaseUrl", "approvedTask", "pendingAnswerReview", "pendingConstraintReview", "constraintReviewAcknowledgement"]).then(({ scoutBaseUrl, approvedTask, pendingAnswerReview, pendingConstraintReview, constraintReviewAcknowledgement }) => {
  const legacyLocalDefault = scoutBaseUrl === "http://localhost:3000" || scoutBaseUrl === "http://127.0.0.1:3000";
  scoutUrlInput.value = !scoutBaseUrl || legacyLocalDefault ? DEFAULT_SCOUT_BASE_URL : scoutBaseUrl;
  if (legacyLocalDefault) void chrome.storage.local.set({ scoutBaseUrl: DEFAULT_SCOUT_BASE_URL });
  if (reviewMatchesTask(pendingAnswerReview, approvedTask)) renderAnswerReview(pendingAnswerReview, approvedTask);
  else if (pendingAnswerReview) void chrome.storage.local.remove("pendingAnswerReview");
  if (constraintReviewMatchesTask(pendingConstraintReview, approvedTask)) renderConstraintReview(pendingConstraintReview, approvedTask, constraintReviewAcknowledgement);
  else if (pendingConstraintReview) void chrome.storage.local.remove(["pendingConstraintReview", "constraintReviewAcknowledgement"]);
});

refreshInspection().catch(() => {
  status.textContent = "Scout could not inspect this page.";
  intelligence.hidden = true;
  fillButton.disabled = true;
});

loadButton.addEventListener("click", () => {
  loadButton.disabled = true;
  status.classList.remove("blocked");

  let baseUrl;
  try {
    baseUrl = normalizeScoutBaseUrl(scoutUrlInput.value);
  } catch (error) {
    loadButton.disabled = false;
    status.classList.add("blocked");
    status.textContent = error instanceof Error ? error.message : "Scout URL is invalid.";
    return;
  }

  // Firefox / Zen requires permissions.request() to be invoked directly from
  // the user-click handler. Do not yield to another async operation before this call.
  const permissionRequest = chrome.permissions.request(scoutOriginPermission(baseUrl));
  void permissionRequest
    .then(async (granted) => {
      if (!granted) throw new Error("Scout origin permission was not granted.");
      await loadApprovedTask(baseUrl);
    })
    .catch((error) => {
      status.classList.add("blocked");
      status.textContent = error instanceof Error ? error.message : "Unable to load Scout task.";
    })
    .finally(() => { loadButton.disabled = false; });
});

fillButton.addEventListener("click", async () => {
  const { approvedTask, pendingConstraintReview, constraintReviewAcknowledgement } = await chrome.storage.local.get(["approvedTask", "pendingConstraintReview", "constraintReviewAcknowledgement"]);
  if (constraintReviewMatchesTask(pendingConstraintReview, approvedTask)
    && pendingConstraintReview.constraints.length
    && !constraintAcknowledgementMatchesTask(constraintReviewAcknowledgement, approvedTask)) {
    renderConstraintReview(pendingConstraintReview, approvedTask, constraintReviewAcknowledgement);
    fillButton.disabled = true;
    status.classList.add("blocked");
    status.textContent = "Review and acknowledge the flagged eligibility/schedule constraints before Safe Fill. Scout will not answer those fields.";
    return;
  }
  const result = await send("SCOUT_FILL");
  const filled = result?.filled ?? 0;
  const reviewed = result?.reviewedDraftsFilled ?? 0;
  renderIntelligence(result?.formIntelligence);
  if (result?.blockers?.length) {
    status.classList.add("blocked");
    status.textContent = `${filled} allowed field(s) filled${reviewed ? `, including ${reviewed} reviewed text answer(s)` : ""}. Still needs you: ${result.blockers.join(" · ")}. Review the form before submit.`;
  } else {
    status.classList.remove("blocked");
    status.textContent = `${filled} allowed field(s) filled${reviewed ? `, including ${reviewed} reviewed text answer(s)` : ""}. Review the whole form and submit manually.`;
  }
});
