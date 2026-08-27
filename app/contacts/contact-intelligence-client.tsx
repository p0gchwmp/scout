"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assessPublishedContact,
  rankPublishedContacts,
  validateLinkedInRecruiterClueUrl,
} from "../../lib/scout/contact-intelligence";
import styles from "./contact-intelligence.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  canonicalUrl: string;
  currentSnapshotId: string | null;
  sourceRegistryId: string | null;
  lifecycleState: string;
};

type ContactEvidence = {
  id: string;
  jobId: string;
  jobSnapshotId: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType?: string;
  suitability: string;
  suitabilityReason: string;
  reviewState: "needs_review" | "accepted" | "rejected";
};

export function ContactIntelligenceWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [contacts, setContacts] = useState<ContactEvidence[]>([]);
  const [jobId, setJobId] = useState("");
  const [clue, setClue] = useState({ name: "", role: "", linkedinUrl: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [jobsResponse, contactsResponse] = await Promise.all([fetch("/api/jobs"), fetch("/api/contacts")]);
    const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
    const contactsPayload = await contactsResponse.json() as { contacts?: ContactEvidence[]; error?: string };
    if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
    if (!contactsResponse.ok) throw new Error(contactsPayload.error ?? "Unable to load contacts");
    setJobs(jobsPayload.jobs ?? []);
    setContacts(contactsPayload.contacts ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load contact intelligence")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const eligibleJobs = useMemo(() => jobs.filter((job) => job.currentSnapshotId && job.sourceRegistryId && job.lifecycleState === "active"), [jobs]);
  const selectedJob = eligibleJobs.find((job) => job.id === jobId) ?? null;
  const selectedContacts = useMemo(() => rankPublishedContacts(
    contacts.filter((contact) => contact.jobId === jobId && contact.reviewState !== "rejected"),
    { name: clue.name, role: clue.role },
  ), [contacts, jobId, clue.name, clue.role]);

  async function research() {
    setError(""); setNotice("");
    if (!jobId) { setError("Choose a resolved internship first."); return; }
    if (clue.linkedinUrl.trim() && !validateLinkedInRecruiterClueUrl(clue.linkedinUrl)) {
      setError("LinkedIn clue must be a normal https://linkedin.com/in/... profile URL. Scout never fetches the profile or extracts hidden contact data from it.");
      return;
    }
    setBusy("research");
    try {
      const response = await fetch("/api/agent/research-contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const payload = await response.json() as { candidatesFound?: number; pagesAttempted?: number; failures?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to research published contacts");
      await load();
      const clueNote = clue.linkedinUrl.trim() || clue.name.trim() || clue.role.trim()
        ? " Your recruiter clue stayed in this browser and was used only to rank published evidence."
        : "";
      setNotice(`Checked ${payload.pagesAttempted ?? 0} bounded official page(s) and found ${payload.candidatesFound ?? 0} published candidate(s).${clueNote} Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to research published contacts");
    } finally { setBusy(null); }
  }

  async function review(contact: ContactEvidence, reviewState: "accepted" | "rejected") {
    setBusy(`review-${contact.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: contact.id, reviewState }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to review contact evidence");
      await load();
      setNotice(reviewState === "accepted" ? "Published contact accepted. Outreach can now be drafted; nothing was sent." : "Contact rejected. Nothing was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to review contact evidence");
    } finally { setBusy(null); }
  }

  async function draft(contact: ContactEvidence) {
    setBusy(`draft-${contact.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agent/draft-outreach/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contact.id }),
      });
      const payload = await response.json() as { draft?: { deterministicFallback?: boolean; model?: string }; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "Unable to create outreach draft");
      setNotice(payload.draft.deterministicFallback
        ? "Safe deterministic outreach draft created because cloud AI was unavailable. Review and approve it in Review Queue before Gmail."
        : `Cloud-AI outreach draft created${payload.draft.model ? ` (${payload.draft.model})` : ""}. Review and approve it before Gmail.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create outreach draft");
    } finally { setBusy(null); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / CONTACT INTELLIGENCE</p>
        <h1>Find the right public recruiting channel, not a guessed email.</h1>
        <p>Use a LinkedIn recruiter profile as a manual clue if helpful. Scout never fetches LinkedIn or extracts hidden contact data from it; it independently searches bounded official company pages for explicitly published business emails and preserves exact provenance.</p>
      </div>
      <nav className={styles.links}><Link href="/inbox">Inbox</Link><Link href="/review">Review Queue</Link><Link href="/">Dashboard</Link></nav>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.finder}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>RECRUITER FINDER</p><h2>Skrapp-like convenience, provenance-first</h2></div><p>Manual recruiter clues are browser-only and never become sendable contact evidence.</p></div>
      <label>Resolved opportunity<select value={jobId} onChange={(event) => setJobId(event.target.value)}><option value="">Choose an internship…</option>{eligibleJobs.map((job) => <option key={job.id} value={job.id}>{job.company} — {job.title}</option>)}</select></label>
      <div className={styles.clueGrid}>
        <label>Recruiter / HR name (optional)<input value={clue.name} onChange={(event) => setClue((value) => ({ ...value, name: event.target.value }))} placeholder="Jane Doe" /></label>
        <label>Role / team (optional)<input value={clue.role} onChange={(event) => setClue((value) => ({ ...value, role: event.target.value }))} placeholder="Talent Acquisition / Campus Recruiting" /></label>
        <label>LinkedIn profile clue (optional)<input value={clue.linkedinUrl} onChange={(event) => setClue((value) => ({ ...value, linkedinUrl: event.target.value }))} placeholder="https://www.linkedin.com/in/..." /></label>
      </div>
      <div className={styles.boundary}>LinkedIn clue → ranking context only. Official company pages → email evidence. No pattern guessing, no LinkedIn email scraping, no data broker.</div>
      <button disabled={busy !== null || !jobId} onClick={() => void research()}>{busy === "research" ? "Checking official pages…" : "Find published recruiting contacts"}</button>
      {selectedJob && <a className={styles.jobLink} href={selectedJob.canonicalUrl} target="_blank" rel="noreferrer">Open official posting ↗</a>}
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>PUBLISHED CONTACTS</p><h2>{selectedContacts.length} candidate(s) for this opportunity</h2></div><p>Deterministic ranking works without AI. AI may refine suitability when a cloud provider is configured, but human acceptance is always required.</p></div>
      {!jobId && <div className={styles.empty}>Choose a resolved opportunity above.</div>}
      {jobId && !selectedContacts.length && <div className={styles.empty}>No published business/recruiting email has been captured for this opportunity yet.</div>}
      <div className={styles.list}>{selectedContacts.map((contact) => {
        const intelligence = assessPublishedContact(contact, { name: clue.name, role: clue.role });
        return <article className={styles.card} key={contact.id}>
          <div>
            <div className={styles.meta}>{contact.reviewState} · {intelligence.signal.replace("_", " ")} · {intelligence.score}/100</div>
            <h3>{contact.email}</h3>
            <p>{contact.excerpt}</p>
            <small>{intelligence.reasons.join(" · ")}</small>
          </div>
          <div className={styles.actions}>
            {contact.reviewState === "needs_review" && <><button disabled={busy !== null} onClick={() => void review(contact, "accepted")}>Accept evidence</button><button className={styles.secondary} disabled={busy !== null} onClick={() => void review(contact, "rejected")}>Reject</button></>}
            {contact.reviewState === "accepted" && <button disabled={busy !== null} onClick={() => void draft(contact)}>{busy === `draft-${contact.id}` ? "Drafting…" : "Draft outreach"}</button>}
            <a href={contact.sourceUrl} target="_blank" rel="noreferrer">Exact published source ↗</a>
          </div>
        </article>;
      })}</div>
    </section>

    <section className={styles.cloud}>
      <p className={styles.kicker}>CLOUD BEHAVIOR</p>
      <h2>Scout does not depend on your laptop.</h2>
      <p>Discovery, official-resolution, contact extraction and deterministic contact ranking work without an AI provider. In cloud deployment, configure a Scout cloud AI provider for higher-quality contact triage and outreach. If AI is unavailable, approved-contact outreach falls back to the deterministic approved-claims template instead of breaking the workflow.</p>
      <p>After you approve the exact outreach revision in <Link href="/review">Review Queue</Link>, Scout can create/reuse a Gmail draft. Final email Send remains manual.</p>
    </section>

    <footer className={styles.safety}>No LinkedIn scraping. No guessed email patterns. No automatic contact acceptance. No autonomous email send.</footer>
  </main>;
}
