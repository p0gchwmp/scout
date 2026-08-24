"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./review.module.css";

type Job = { id: string; company: string; title: string; canonicalUrl: string };
type Application = {
  id: string;
  jobId: string;
  status: string;
  artifactVersion: number;
  blockers: string[];
  submittedFields: {
    channel?: { label?: string; note?: string };
    applicationUrl?: string;
    claimIds?: string[];
  };
  job: Job | null;
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
type OutreachRevision = {
  id: string;
  version: number;
  body: string;
  claimIds: string[];
  contactId: string;
  jobSnapshotId: string;
};
type OutreachDraft = {
  id: string;
  jobId: string;
  state: "draft" | "approved" | "rejected";
  approvedRevisionId?: string | null;
  revisions: OutreachRevision[];
};

type GmailDraftResult = {
  draftId: string;
  messageId: string;
  scoutMessageId: string;
  reused: boolean;
  outreachDraftId: string;
  outreachRevisionId: string;
};

export function ReviewQueue() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<ContactEvidence[]>([]);
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [jobsResponse, applicationsResponse, contactsResponse, outreachResponse] = await Promise.all([
      fetch("/api/jobs"),
      fetch("/api/applications"),
      fetch("/api/contacts"),
      fetch("/api/outreach"),
    ]);
    const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
    const applicationsPayload = await applicationsResponse.json() as { applications?: Application[]; error?: string };
    const contactsPayload = await contactsResponse.json() as { contacts?: ContactEvidence[]; error?: string };
    const outreachPayload = await outreachResponse.json() as { drafts?: OutreachDraft[]; error?: string };
    if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
    if (!applicationsResponse.ok) throw new Error(applicationsPayload.error ?? "Unable to load applications");
    if (!contactsResponse.ok) throw new Error(contactsPayload.error ?? "Unable to load contacts");
    if (!outreachResponse.ok) throw new Error(outreachPayload.error ?? "Unable to load outreach drafts");
    setJobs(jobsPayload.jobs ?? []);
    setApplications(applicationsPayload.applications ?? []);
    setContacts(contactsPayload.contacts ?? []);
    setDrafts(outreachPayload.drafts ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load review queue"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const readyApplications = applications.filter((application) => application.status === "ready_for_review");
  const blockedApplications = applications.filter((application) => application.status !== "ready_for_review");
  const contactsNeedReview = contacts.filter((contact) => contact.reviewState === "needs_review");
  const acceptedContacts = contacts.filter((contact) => contact.reviewState === "accepted");
  const pendingDrafts = drafts.filter((draft) => draft.state === "draft");
  const approvedDrafts = drafts.filter((draft) => draft.state === "approved");

  async function reviewContact(contact: ContactEvidence, reviewState: "accepted" | "rejected") {
    setBusy(`contact-${contact.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: contact.id, reviewState }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to review contact evidence");
      setNotice(reviewState === "accepted"
        ? "Published contact evidence accepted. You can now create a humanized outreach draft; nothing was sent."
        : "Contact evidence rejected. Nothing was sent.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to review contact evidence");
    } finally { setBusy(null); }
  }

  async function draftFromContact(contact: ContactEvidence) {
    setBusy(`contact-draft-${contact.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agent/draft-outreach/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contact.id }),
      });
      const payload = await response.json() as { draft?: { id?: string; voiceSampleUsed?: boolean }; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "Unable to create humanized outreach draft");
      setNotice(`Humanized outreach draft created${payload.draft.voiceSampleUsed ? " using your verified writing sample" : ""}. Review the exact revision below before approving it.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create humanized outreach draft");
    } finally { setBusy(null); }
  }

  async function reviewDraft(draft: OutreachDraft, action: "approve" | "reject") {
    const revision = draft.revisions.at(-1);
    if (!revision) return;
    setBusy(`${action}-${draft.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/outreach", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, action, revisionId: revision.id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Unable to ${action} outreach draft`);
      setNotice(action === "approve"
        ? "Outreach revision approved. It is now eligible for Gmail draft creation; nothing was sent."
        : "Outreach draft rejected. Nothing was sent.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to ${action} outreach draft`);
    } finally { setBusy(null); }
  }

  async function createGmailDraft(draft: OutreachDraft) {
    setBusy(`gmail-${draft.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agent/create-gmail-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      const payload = await response.json() as { gmailDraft?: GmailDraftResult; error?: string };
      if (!response.ok || !payload.gmailDraft) throw new Error(payload.error ?? "Unable to create Gmail draft");
      setNotice(payload.gmailDraft.reused
        ? `Existing Gmail draft reused (${payload.gmailDraft.draftId}). Nothing was sent.`
        : `Gmail draft created (${payload.gmailDraft.draftId}). Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Gmail draft");
    } finally { setBusy(null); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / REVIEW QUEUE</p>
        <h1>Only the decisions that need you.</h1>
        <p>Review published contacts and outreach, create Gmail drafts after approval, and hand ready applications to Safe Fill. Scout still has no email-send or application-submit action.</p>
      </div>
      <nav className={styles.links} aria-label="Scout review navigation">
        <Link href="/">Dashboard</Link>
        <Link href="/inbox">Inbox</Link>
        <Link href="/assist">Browser assist</Link>
        <Link href="/voice">Voice</Link>
      </nav>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary} aria-label="Review queue summary">
      <div><strong>{contactsNeedReview.length}</strong><span>contacts to review</span></div>
      <div><strong>{pendingDrafts.length}</strong><span>outreach drafts to review</span></div>
      <div><strong>{approvedDrafts.length}</strong><span>approved outreach drafts</span></div>
      <div><strong>{readyApplications.length}</strong><span>applications ready for assist</span></div>
      <div><strong>{blockedApplications.length}</strong><span>applications needing input</span></div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>PUBLISHED CONTACT EVIDENCE</p><h2>Accept the channel, not a guess</h2></div><p>{acceptedContacts.length} accepted · {contactsNeedReview.length} need review</p></div>
      <div className={styles.list}>
        {!contacts.length && <div className={styles.empty}>No published recruiting/business contacts found yet.</div>}
        {contacts.filter((contact) => contact.reviewState !== "rejected").map((contact) => {
          const job = jobById.get(contact.jobId);
          return <article className={styles.card} key={contact.id}>
            <div className={styles.cardMain}>
              <div className={styles.meta}>{contact.reviewState} · {contact.suitability} · {contact.sourceType ?? "official source"}</div>
              <h3>{contact.email}</h3>
              <p>{job ? `${job.company} — ${job.title}` : "Pinned internship"}</p>
              <p>{contact.excerpt}</p>
              <small>{contact.suitabilityReason}</small>
            </div>
            <div className={styles.actions}>
              {contact.reviewState === "needs_review" && <>
                <button disabled={busy !== null} onClick={() => void reviewContact(contact, "accepted")}>Accept published evidence</button>
                <button className={styles.secondary} disabled={busy !== null} onClick={() => void reviewContact(contact, "rejected")}>Reject</button>
              </>}
              {contact.reviewState === "accepted" && <button disabled={busy !== null} onClick={() => void draftFromContact(contact)}>{busy === `contact-draft-${contact.id}` ? "Drafting…" : "Create humanized outreach"}</button>}
              <a href={contact.sourceUrl} target="_blank" rel="noreferrer">Exact source ↗</a>
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>OUTREACH</p><h2>Review before Gmail</h2></div><p>Only an approved exact revision can become a Gmail draft.</p></div>
      <div className={styles.list}>
        {!drafts.length && <div className={styles.empty}>No outreach drafts yet.</div>}
        {drafts.map((draft) => {
          const revision = draft.revisions.at(-1);
          const job = jobById.get(draft.jobId);
          return <article className={styles.card} key={draft.id}>
            <div className={styles.cardMain}>
              <div className={styles.meta}>{draft.state} · revision {revision?.version ?? "?"}</div>
              <h3>{job ? `${job.company} — ${job.title}` : "Pinned internship outreach"}</h3>
              {revision && <>
                <pre className={styles.preview}>{revision.body}</pre>
                <small>Claims: {revision.claimIds.join(", ")} · Snapshot: {revision.jobSnapshotId}</small>
              </>}
            </div>
            <div className={styles.actions}>
              {draft.state === "draft" && revision && <>
                <button disabled={busy !== null} onClick={() => void reviewDraft(draft, "approve")}>Approve exact revision</button>
                <button className={styles.secondary} disabled={busy !== null} onClick={() => void reviewDraft(draft, "reject")}>Reject</button>
              </>}
              {draft.state === "approved" && <button disabled={busy !== null} onClick={() => void createGmailDraft(draft)}>{busy === `gmail-${draft.id}` ? "Creating…" : "Create Gmail draft"}</button>}
              {job && <a href={job.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a>}
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>APPLICATIONS</p><h2>Ready for browser assist</h2></div><p>Safe Fill handles reusable facts and draftable text; final submit stays manual.</p></div>
      <div className={styles.list}>
        {!applications.length && <div className={styles.empty}>No application packets yet.</div>}
        {applications.map((application) => {
          const job = application.job ?? jobById.get(application.jobId) ?? null;
          return <article className={styles.card} key={application.id}>
            <div className={styles.cardMain}>
              <div className={styles.meta}>{application.submittedFields.channel?.label ?? "Application"} · {application.status} · packet v{application.artifactVersion}</div>
              <h3>{job ? `${job.company} — ${job.title}` : "Application packet"}</h3>
              {application.blockers.length ? <ul>{application.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p>No preparation blockers. Review the official form before filling.</p>}
            </div>
            <div className={styles.actions}>
              {application.status === "ready_for_review" ? <Link href="/assist">Create Safe Fill handoff</Link> : <span>Needs profile/eligibility input first</span>}
              {application.submittedFields.applicationUrl && <a href={application.submittedFields.applicationUrl} target="_blank" rel="noreferrer">Open application ↗</a>}
            </div>
          </article>;
        })}
      </div>
    </section>

    <footer className={styles.safety}>No autonomous email send. No autonomous application submit. No CAPTCHA bypass.</footer>
  </main>;
}
