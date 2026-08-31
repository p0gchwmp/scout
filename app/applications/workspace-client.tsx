"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildApplicationProgress } from "../../lib/scout/application-progress";
import { assessFollowUp, type FollowUpBucket } from "../../lib/scout/follow-up-intelligence";
import styles from "./workspace.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  canonicalUrl: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  postedAt: string | null;
  lastSeenAt: string;
};

type Application = {
  id: string;
  jobId: string;
  status: string;
  blockers: string[];
  artifactVersion: number;
  submittedAt: string | null;
  confirmationUrl: string | null;
};

type Contact = { id: string; jobId: string; reviewState: "needs_review" | "accepted" | "rejected" };
type Draft = { id: string; jobId: string; state: "draft" | "approved" | "rejected" };
type Filter = "Today" | "Soon" | "Waiting" | "Done" | "All";

type SubmissionEditor = {
  applicationId: string;
  confirmationUrl: string;
  confirmed: boolean;
};

const filters: Filter[] = ["Today", "Soon", "Waiting", "Done", "All"];
const bucketForFilter: Record<Exclude<Filter, "All">, FollowUpBucket> = {
  Today: "today",
  Soon: "soon",
  Waiting: "waiting",
  Done: "done",
};

function displayDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compareSortKey(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function ApplicationWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [filter, setFilter] = useState<Filter>("Today");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submissionEditor, setSubmissionEditor] = useState<SubmissionEditor | null>(null);

  const load = useCallback(async () => {
    setError("");
    const [jobsResponse, applicationsResponse, contactsResponse, draftsResponse] = await Promise.all([
      fetch("/api/jobs"), fetch("/api/applications"), fetch("/api/contacts"), fetch("/api/outreach"),
    ]);
    const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
    const applicationsPayload = await applicationsResponse.json() as { applications?: Application[]; error?: string };
    const contactsPayload = await contactsResponse.json() as { contacts?: Contact[]; error?: string };
    const draftsPayload = await draftsResponse.json() as { drafts?: Draft[]; error?: string };
    if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
    if (!applicationsResponse.ok) throw new Error(applicationsPayload.error ?? "Unable to load application packets");
    if (!contactsResponse.ok) throw new Error(contactsPayload.error ?? "Unable to load contacts");
    if (!draftsResponse.ok) throw new Error(draftsPayload.error ?? "Unable to load outreach drafts");
    setJobs(jobsPayload.jobs ?? []);
    setApplications(applicationsPayload.applications ?? []);
    setContacts(contactsPayload.contacts ?? []);
    setDrafts(draftsPayload.drafts ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load application workspace")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(() => {
    const now = new Date();
    return jobs.map((job) => {
      const application = applications.find((item) => item.jobId === job.id) ?? null;
      const jobContacts = contacts.filter((item) => item.jobId === job.id);
      const jobDrafts = drafts.filter((item) => item.jobId === job.id);
      return {
        job,
        application,
        progress: buildApplicationProgress({ job, application, contacts: jobContacts, drafts: jobDrafts }),
        followUp: assessFollowUp({ job, application, contacts: jobContacts, drafts: jobDrafts, now }),
      };
    }).sort((left, right) => compareSortKey(left.followUp.sortKey, right.followUp.sortKey)
      || Date.parse(right.job.lastSeenAt) - Date.parse(left.job.lastSeenAt));
  }, [jobs, applications, contacts, drafts]);

  const visible = useMemo(() => rows.filter(({ job, followUp }) => {
    const haystack = `${job.company} ${job.title} ${job.location}`.toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    if (filter !== "All") return followUp.bucket === bucketForFilter[filter];
    return true;
  }), [rows, filter, query]);

  const summary = useMemo(() => ({
    today: rows.filter(({ followUp }) => followUp.bucket === "today").length,
    soon: rows.filter(({ followUp }) => followUp.bucket === "soon").length,
    waiting: rows.filter(({ followUp }) => followUp.bucket === "waiting").length,
    done: rows.filter(({ followUp }) => followUp.bucket === "done").length,
  }), [rows]);

  async function updateSubmission(application: Application, action: "mark_external_submission" | "clear_external_submission", confirmationUrl?: string) {
    setBusy(`submission:${application.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/application-progress", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          applicationId: application.id,
          expectedArtifactVersion: application.artifactVersion,
          ...(action === "mark_external_submission" && confirmationUrl?.trim() ? { confirmationUrl: confirmationUrl.trim() } : {}),
        }),
      });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update submission record");
      setNotice(payload.message ?? "Application progress updated.");
      setSubmissionEditor(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update submission record");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <main className={styles.shell}><p>Loading application workspace…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / ACTION QUEUE</p>
        <h1>Today, soon, waiting, done.</h1>
        <p>Scout turns explicit official deadlines, application state, contact review and outreach state into a conservative action queue. Submission age is descriptive only: Scout does not invent recruiter-response or follow-up deadlines.</p>
      </div>
      <div className={styles.headerLinks}>
        <Link href="/">Dashboard</Link><Link href="/shortlist">Shortlist</Link><Link href="/readiness">Readiness</Link><Link href="/assist">Safe Fill</Link><Link href="/review">Review</Link>
      </div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary} aria-label="Deadline and follow-up queue summary">
      <button type="button" className={filter === "Today" ? styles.summaryActive : ""} onClick={() => setFilter("Today")}><strong>{summary.today}</strong><span>Today</span></button>
      <button type="button" className={filter === "Soon" ? styles.summaryActive : ""} onClick={() => setFilter("Soon")}><strong>{summary.soon}</strong><span>Soon</span></button>
      <button type="button" className={filter === "Waiting" ? styles.summaryActive : ""} onClick={() => setFilter("Waiting")}><strong>{summary.waiting}</strong><span>Waiting</span></button>
      <button type="button" className={filter === "Done" ? styles.summaryActive : ""} onClick={() => setFilter("Done")}><strong>{summary.done}</strong><span>Done</span></button>
    </section>

    <section className={styles.queueLegend}>
      <span><strong>Today</strong> explicit deadline ≤2 days or a human review decision</span>
      <span><strong>Soon</strong> active application/outreach work</span>
      <span><strong>Waiting</strong> submitted with no pending review decision</span>
      <span><strong>Done</strong> rejected or closed without submission</span>
    </section>

    <section className={styles.controls}>
      <div className={styles.filters}>{filters.map((item) => <button key={item} className={filter === item ? styles.active : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, role, location" aria-label="Search application workspace" />
    </section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>Nothing in {filter.toLowerCase()} right now. Use another queue view to see the rest of your roles.</div>}
      {visible.map(({ job, application, progress, followUp }) => <article className={`${styles.card} ${styles[`bucket_${followUp.bucket}`] ?? ""}`} key={job.id}>
        <div className={styles.topline}>
          <div><p className={styles.company}>{job.company}</p><h2>{job.title}</h2><p className={styles.meta}>{job.location || "Location not specified"} · {job.workplaceType || "Workplace unspecified"}</p></div>
          <div className={styles.state}><strong className={styles[followUp.bucket]}>{followUp.label}</strong><span>{job.lifecycleState}</span></div>
        </div>

        <div className={styles.queueReason}><span>WHY HERE</span><strong>{followUp.reason}</strong><small>{followUp.freshness.label}</small></div>

        <div className={styles.nextStep}><span>WHAT NEXT</span><strong>{progress.summary}</strong>{progress.nextAction.kind !== "none" && <Link href={progress.nextAction.href}>{progress.nextAction.label} →</Link>}</div>

        {followUp.deadline && <div className={styles.deadline}>
          <strong>{followUp.deadline.label}</strong>
          <span>{followUp.deadline.raw}</span>
          <small>{followUp.deadline.dateIso ? `Parsed explicit date: ${followUp.deadline.dateIso}. ` : "Date was not parsed because Scout will not guess an ambiguous date. "}Shown only from immutable official job evidence.</small>
        </div>}

        <div className={styles.timeline}>
          {progress.stages.map((stage) => <div className={`${styles.stage} ${styles[stage.state]}`} key={stage.id}>
            <span className={styles.dot} aria-hidden="true" />
            <div><strong>{stage.label}</strong><p>{stage.detail}</p></div>
          </div>)}
        </div>

        {application && !progress.externallySubmitted && submissionEditor?.applicationId === application.id && <div className={styles.submissionPanel}>
          <strong>Record a submission you already completed yourself</strong>
          <p>This does not open, fill, click or submit the employer form. It only updates Scout’s local progress record.</p>
          <label>Confirmation URL (optional)<input type="url" placeholder="https://…" value={submissionEditor.confirmationUrl} onChange={(event) => setSubmissionEditor((current) => current ? { ...current, confirmationUrl: event.target.value } : current)} /></label>
          <label className={styles.confirm}><input type="checkbox" checked={submissionEditor.confirmed} onChange={(event) => setSubmissionEditor((current) => current ? { ...current, confirmed: event.target.checked } : current)} /> I confirm I already submitted this application on the employer site.</label>
          <div className={styles.actions}><button disabled={!submissionEditor.confirmed || busy === `submission:${application.id}`} className={styles.primary} onClick={() => void updateSubmission(application, "mark_external_submission", submissionEditor.confirmationUrl)}>Record external submission</button><button onClick={() => setSubmissionEditor(null)}>Cancel</button></div>
        </div>}

        <div className={styles.actions}>
          <a href={job.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a>
          <Link href={`/roles/${job.id}`}>Review role evidence →</Link>
          {application && !progress.externallySubmitted && submissionEditor?.applicationId !== application.id && <button onClick={() => setSubmissionEditor({ applicationId: application.id, confirmationUrl: "", confirmed: false })}>I submitted this externally</button>}
          {application && progress.externallySubmitted && <button className={styles.mutedAction} disabled={busy === `submission:${application.id}`} onClick={() => {
            if (window.confirm("Clear Scout’s submission record for this application? This will not change anything on the employer site.")) void updateSubmission(application, "clear_external_submission");
          }}>Clear submission record</button>}
          {progress.confirmationUrl && <a href={progress.confirmationUrl} target="_blank" rel="noreferrer">Confirmation evidence ↗</a>}
        </div>

        <footer className={styles.cardFooter}>
          <span>Last observed {displayDate(job.lastSeenAt)}</span>
          <span>{job.postedAt ? `Posted ${displayDate(job.postedAt)}` : "Posting date unavailable"}</span>
          <span>{application ? `Application packet v${application.artifactVersion}` : "No packet yet"}</span>
          {followUp.waitingDays !== null && <span>Waiting age: {followUp.waitingDays} day(s)</span>}
          <span>Scout submission capability: disabled</span>
        </footer>
      </article>)}
    </section>

    <section className={styles.boundary}><strong>Boundary:</strong> Today/Soon are prioritization aids, not inferred employer commitments. “Waiting” does not mean Scout knows whether a recruiter has read or responded. No follow-up is scheduled or sent automatically.</section>
  </main>;
}
