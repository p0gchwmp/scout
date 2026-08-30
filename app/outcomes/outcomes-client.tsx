"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APPLICATION_OUTCOME_STATES, outcomeGuidance, type ApplicationOutcomeState } from "../../lib/scout/application-outcomes";
import styles from "../applications/workspace.module.css";

type Job = { company: string; title: string; canonicalUrl: string };
type Application = {
  id: string; jobId: string; status: string; artifactVersion: number;
  submittedAt: string | null; approvedAt: string | null; job?: Job | null;
};

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function OutcomesWorkspace() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/applications");
    const payload = await response.json() as { applications?: Application[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load outcomes");
    setApplications((payload.applications ?? []).filter((item) => Boolean(item.submittedAt)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load outcomes")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(() => applications.map((application) => ({ application, guidance: outcomeGuidance(application) }))
    .sort((a, b) => Number(b.guidance.followUpDue) - Number(a.guidance.followUpDue)), [applications]);

  async function mutate(application: Application, body: Record<string, unknown>) {
    setBusy(application.id); setNotice(""); setError("");
    try {
      const response = await fetch("/api/application-outcomes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: application.id, expectedArtifactVersion: application.artifactVersion, ...body }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update outcome");
      setNotice("Outcome tracking updated. No email or employer-side action was performed.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update outcome");
    } finally { setBusy(null); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / OUTCOMES</p><h1>What happened after you acted?</h1><p>Record only facts you know. Follow-up dates are explicit choices, not guesses about recruiter behavior.</p></div>
      <div className={styles.headerLinks}><Link href="/applications">Applications</Link><Link href="/command-center">Command Center</Link><Link href="/">Dashboard</Link></div>
    </header>

    <section className={styles.queueLegend}><span><strong>Gmail boundary</strong> Scout can create approved Gmail drafts elsewhere, but its current runtime does not read Gmail threads. M16 never claims a recruiter replied unless you record it, and never sends follow-ups automatically.</span></section>
    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.list}>
      {!rows.length && <div className={styles.empty}>No externally submitted applications are recorded yet.</div>}
      {rows.map(({ application, guidance }) => <article className={styles.card} key={application.id}>
        <div className={styles.topline}>
          <div><p className={styles.company}>{application.job?.company ?? "Company unavailable"}</p><h2>{application.job?.title ?? "Application"}</h2></div>
          <strong>{guidance.followUpDue ? "FOLLOW-UP DUE" : guidance.label}</strong>
        </div>
        <div className={styles.queueReason}><span>WHAT NEXT</span><strong>{guidance.guidance}</strong></div>

        <label>Known outcome
          <select value={guidance.state ?? "awaiting_reply"} disabled={busy === application.id}
            onChange={(event) => void mutate(application, { action: "set_outcome", outcome: event.target.value as ApplicationOutcomeState })}>
            {APPLICATION_OUTCOME_STATES.map((state) => <option key={state} value={state}>{label(state)}</option>)}
          </select>
        </label>

        {(guidance.state === "rejected" || guidance.state === "offer" || guidance.state === "withdrawn") &&
          <button disabled={busy === application.id} onClick={() => void mutate(application, { action: "clear_outcome" })}>Clear recorded outcome</button>}

        <label>My follow-up date (optional)
          <input type="datetime-local" defaultValue={localInput(application.approvedAt)} disabled={busy === application.id}
            onBlur={(event) => {
              if (!event.currentTarget.value) {
                if (application.approvedAt) void mutate(application, { action: "clear_follow_up" });
                return;
              }
              const followUpAt = new Date(event.currentTarget.value).toISOString();
              if (followUpAt !== application.approvedAt) void mutate(application, { action: "set_follow_up", followUpAt });
            }} />
        </label>

        <div className={styles.actions}>
          {application.job?.canonicalUrl && <a href={application.job.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a>}
          <Link href="/review">Review contact/outreach →</Link>
        </div>
        <footer className={styles.cardFooter}>
          <span>Submitted: {application.submittedAt ? new Date(application.submittedAt).toLocaleString() : "Not recorded"}</span>
          {guidance.followUpAt && <span>Follow-up: {new Date(guidance.followUpAt).toLocaleString()}</span>}
          <span>Tracking v{application.artifactVersion}</span>
        </footer>
      </article>)}
    </section>
  </main>;
}
