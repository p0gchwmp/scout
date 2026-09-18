"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./review.module.css";

type Target = {
  id: string;
  companyName: string;
  companyDomain: string;
  officialUrl: string;
  track: "now_remote" | "summer_2027";
  origin: "manual" | "controlled_source" | "watchlist";
  researchFocus: string | null;
  priorityScore: number;
  state: "active" | "archived";
};

type Contact = {
  id: string;
  targetId: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: string;
  sourceContext?: string | null;
  suitabilityReason: string;
  reviewState: "needs_review" | "accepted" | "rejected";
};

type Revision = { id: string; version: number; body: string; claimIds: string[]; contactId: string };
type Draft = {
  id: string;
  targetId: string;
  state: "draft" | "approved" | "rejected";
  approvedRevisionId?: string | null;
  revisions: Revision[];
};

type ErrorPayload = { error?: string };

async function requestJson<T extends ErrorPayload>(endpoint: string, init: RequestInit | undefined, failureLabel: string): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  const response = await fetch(endpoint, { ...init, headers });
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const text = await response.text();

  if (!contentType.includes("json")) {
    throw new Error(`${failureLabel}: ${endpoint} returned HTTP ${response.status} without JSON`);
  }
  if (!text.trim()) {
    throw new Error(`${failureLabel}: ${endpoint} returned HTTP ${response.status} with an empty JSON response`);
  }

  let payload: T;
  try {
    payload = JSON.parse(text) as T;
  } catch {
    throw new Error(`${failureLabel}: ${endpoint} returned invalid JSON (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`${failureLabel}: ${payload.error ?? `HTTP ${response.status}`} (${endpoint}, HTTP ${response.status})`);
  }
  return payload;
}

function failureMessage(result: PromiseRejectedResult) {
  return result.reason instanceof Error ? result.reason.message : "Scout outreach data request failed";
}

export function AutopilotPanel() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [targetsResult, contactsResult, draftsResult] = await Promise.allSettled([
      requestJson<{ targets?: Target[]; error?: string }>("/api/company-outreach", undefined, "Unable to load Scout outreach targets"),
      requestJson<{ contacts?: Contact[]; error?: string }>("/api/company-outreach/contacts", undefined, "Unable to load Scout outreach contacts"),
      requestJson<{ drafts?: Draft[]; error?: string }>("/api/company-outreach/drafts", undefined, "Unable to load Scout outreach drafts"),
    ]);

    const failures: string[] = [];
    if (targetsResult.status === "fulfilled") {
      setTargets((targetsResult.value.targets ?? []).filter((target) => target.state === "active"));
    } else failures.push(failureMessage(targetsResult));

    if (contactsResult.status === "fulfilled") {
      setContacts(contactsResult.value.contacts ?? []);
    } else failures.push(failureMessage(contactsResult));

    if (draftsResult.status === "fulfilled") {
      setDrafts(draftsResult.value.drafts ?? []);
    } else failures.push(failureMessage(draftsResult));

    if (failures.length) throw new Error(failures.join(" · "));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load Scout autopilot")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
  const contactsToReview = contacts.filter((contact) => contact.reviewState === "needs_review");
  const acceptedContacts = contacts.filter((contact) => contact.reviewState === "accepted");
  const pendingDrafts = drafts.filter((draft) => draft.state === "draft");
  const approvedDrafts = drafts.filter((draft) => draft.state === "approved");

  async function runScout() {
    setBusy("run"); setError(""); setNotice("");
    try {
      const [discoveryResult, outreachResult] = await Promise.allSettled([
        requestJson<{ found?: number; error?: string }>(
          "/api/agent/discover",
          { method: "POST" },
          "Internship discovery failed",
        ),
        requestJson<{
          createdTargets?: number;
          queuedTargets?: number;
          researchedTargets?: number;
          candidatesFound?: number;
          searchQueriesAttempted?: number;
          searchProvider?: string | null;
          error?: string;
        }>(
          "/api/company-outreach/autopilot",
          { method: "POST" },
          "Company outreach autopilot failed",
        ),
      ]);

      await load();
      if (discoveryResult.status === "rejected" && outreachResult.status === "rejected") {
        throw new Error(`${failureMessage(discoveryResult)} · ${failureMessage(outreachResult)}`);
      }

      const discoveryFound = discoveryResult.status === "fulfilled" ? discoveryResult.value.found ?? 0 : 0;
      const outreach = outreachResult.status === "fulfilled" ? outreachResult.value : null;
      const partialErrors = [
        discoveryResult.status === "rejected" ? failureMessage(discoveryResult) : null,
        outreachResult.status === "rejected" ? failureMessage(outreachResult) : null,
      ].filter((value): value is string => Boolean(value));

      setNotice(`Scout prep complete: ${discoveryFound} internship lead(s), ${outreach?.queuedTargets ?? 0} company target(s), ${outreach?.researchedTargets ?? 0} company research pass(es), ${outreach?.candidatesFound ?? 0} published contact candidate(s).${outreach?.searchProvider ? ` Public search: ${outreach.searchProvider}.` : " Company outreach can still use bounded first-party research."}${partialErrors.length ? ` Partial lane issue: ${partialErrors.join(" · ")}.` : ""} Nothing was sent or submitted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Scout prep failed");
    } finally { setBusy(null); }
  }

  async function reviewContact(contact: Contact, reviewState: "accepted" | "rejected") {
    setBusy(`contact-${contact.id}`); setError(""); setNotice("");
    try {
      await requestJson<{ error?: string }>(
        "/api/company-outreach/contacts",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: contact.id, reviewState }),
        },
        "Unable to review public contact evidence",
      );
      await load();
      setNotice(reviewState === "accepted" ? "Published contact accepted. Scout can now draft from automatically selected approved claims." : "Contact rejected. Nothing was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to review contact");
    } finally { setBusy(null); }
  }

  async function createDraft(contact: Contact) {
    setBusy(`draft-${contact.id}`); setError(""); setNotice("");
    try {
      const payload = await requestJson<{ draft?: { model?: string; deterministicFallback?: boolean; claimSelection?: string }; error?: string }>(
        "/api/company-outreach/drafts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactId: contact.id }),
        },
        "Unable to draft speculative outreach",
      );
      if (!payload.draft) throw new Error("Unable to draft speculative outreach: response did not include a draft");
      await load();
      setNotice(`Scout drafted the outreach using ${payload.draft.claimSelection === "automatic" ? "automatically matched approved claims" : "approved claim evidence"}${payload.draft.deterministicFallback ? " with the deterministic fallback" : payload.draft.model ? ` via ${payload.draft.model}` : ""}. Review the exact revision below.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to draft outreach");
    } finally { setBusy(null); }
  }

  async function reviewDraft(draft: Draft, action: "approve" | "reject") {
    const revision = draft.revisions.at(-1);
    if (!revision) return;
    setBusy(`${action}-${draft.id}`); setError(""); setNotice("");
    try {
      await requestJson<{ error?: string }>(
        "/api/company-outreach/drafts",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: draft.id, action, revisionId: revision.id }),
        },
        `Unable to ${action} draft`,
      );
      await load();
      setNotice(action === "approve" ? "Exact company-first revision approved. It can become a Gmail draft; nothing was sent." : "Draft rejected. Nothing was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to ${action} draft`);
    } finally { setBusy(null); }
  }

  async function createGmailDraft(draft: Draft) {
    setBusy(`gmail-${draft.id}`); setError(""); setNotice("");
    try {
      const payload = await requestJson<{ gmailDraft?: { draftId?: string; reused?: boolean }; error?: string }>(
        "/api/company-outreach/gmail-draft",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ draftId: draft.id }),
        },
        "Unable to create Gmail draft",
      );
      if (!payload.gmailDraft) throw new Error("Unable to create Gmail draft: response did not include a Gmail draft");
      setNotice(payload.gmailDraft.reused ? `Existing Gmail draft reused (${payload.gmailDraft.draftId}). Nothing was sent.` : `Gmail draft created (${payload.gmailDraft.draftId}). Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Gmail draft");
    } finally { setBusy(null); }
  }

  return <>
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>SCOUT AUTOPILOT</p><h2>Two lanes, one review queue.</h2></div>
        <p>Internship discovery and company/VC outreach prep run independently, so one lane failing does not erase useful work from the other. You review evidence and final copy.</p>
      </div>
      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}
      <div className={styles.actions}>
        <button disabled={busy !== null} onClick={() => void runScout()}>{busy === "run" ? "Scout is hunting…" : "Run Scout"}</button>
      </div>
      <div className={styles.summary} aria-label="Autopilot queue summary">
        <div><strong>{targets.length}</strong><span>companies queued · no legacy 15-company display cap</span></div>
        <div><strong>{contactsToReview.length}</strong><span>company contacts to review</span></div>
        <div><strong>{pendingDrafts.length}</strong><span>company drafts to review</span></div>
        <div><strong>{approvedDrafts.length}</strong><span>approved company drafts</span></div>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>COMPANIES WORTH CONTACTING</p><h2>Automatically ranked targets</h2></div><p>Manual company/domain entry is no longer required for the normal path.</p></div>
      <div className={styles.list}>
        {!targets.length && <div className={styles.empty}>Run Scout to create the first company outreach queue.</div>}
        {targets.slice().sort((left, right) => right.priorityScore - left.priorityScore).map((target) => <article className={styles.card} key={target.id}>
          <div className={styles.cardMain}>
            <div className={styles.meta}>{target.track === "now_remote" ? "Now · Remote" : "Summer 2027"} · {target.origin.replaceAll("_", " ")} · priority {target.priorityScore}</div>
            <h3>{target.companyName}</h3>
            <p>{target.researchFocus ?? "Controlled Scout company target"}</p>
          </div>
          <div className={styles.actions}><a href={target.officialUrl} target="_blank" rel="noreferrer">Official site ↗</a></div>
        </article>)}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>COMPANY CONTACT EVIDENCE</p><h2>Only decisions that need you</h2></div><p>{acceptedContacts.length} accepted · {contactsToReview.length} need review</p></div>
      <div className={styles.list}>
        {!contacts.filter((contact) => contact.reviewState !== "rejected").length && <div className={styles.empty}>No verified public company contact evidence yet.</div>}
        {contacts.filter((contact) => contact.reviewState !== "rejected").map((contact) => {
          const target = targetById.get(contact.targetId);
          return <article className={styles.card} key={contact.id}>
            <div className={styles.cardMain}>
              <div className={styles.meta}>{contact.reviewState} · {contact.sourceContext?.replaceAll("_", " ") ?? contact.sourceType}</div>
              <h3>{contact.email}</h3>
              <p>{target?.companyName ?? "Company outreach target"}</p>
              <p>{contact.excerpt}</p>
              <small>{contact.suitabilityReason}</small>
            </div>
            <div className={styles.actions}>
              {contact.reviewState === "needs_review" && <>
                <button disabled={busy !== null} onClick={() => void reviewContact(contact, "accepted")}>Accept evidence</button>
                <button className={styles.secondary} disabled={busy !== null} onClick={() => void reviewContact(contact, "rejected")}>Reject</button>
              </>}
              {contact.reviewState === "accepted" && <button disabled={busy !== null} onClick={() => void createDraft(contact)}>{busy === `draft-${contact.id}` ? "Drafting…" : "Draft outreach"}</button>}
              <a href={contact.sourceUrl} target="_blank" rel="noreferrer">Exact source ↗</a>
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>COMPANY-FIRST DRAFTS</p><h2>Review exact copy before Gmail</h2></div><p>Scout still cannot send anything.</p></div>
      <div className={styles.list}>
        {!drafts.length && <div className={styles.empty}>No company-first drafts yet.</div>}
        {drafts.map((draft) => {
          const revision = draft.revisions.at(-1);
          const target = targetById.get(draft.targetId);
          return <article className={styles.card} key={draft.id}>
            <div className={styles.cardMain}>
              <div className={styles.meta}>{draft.state} · revision {revision?.version ?? "?"}</div>
              <h3>{target?.companyName ?? "Company-first outreach"}</h3>
              {revision && <><pre className={styles.preview}>{revision.body}</pre><small>Approved claim pins: {revision.claimIds.join(", ")}</small></>}
            </div>
            <div className={styles.actions}>
              {draft.state === "draft" && revision && <>
                <button disabled={busy !== null} onClick={() => void reviewDraft(draft, "approve")}>Approve exact revision</button>
                <button className={styles.secondary} disabled={busy !== null} onClick={() => void reviewDraft(draft, "reject")}>Reject</button>
              </>}
              {draft.state === "approved" && <button disabled={busy !== null} onClick={() => void createGmailDraft(draft)}>{busy === `gmail-${draft.id}` ? "Creating…" : "Create Gmail draft"}</button>}
            </div>
          </article>;
        })}
      </div>
    </section>
  </>;
}
