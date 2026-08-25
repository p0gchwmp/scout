"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./assist.module.css";

type Job = { id: string; company: string; title: string; canonicalUrl: string };
type Application = {
  id: string;
  jobId: string;
  status: string;
  artifactVersion: number;
  blockers: string[];
  submittedAt: string | null;
  submittedFields: {
    applicationUrl?: string;
    channel?: { label?: string; automation?: string };
  };
  job: Job | null;
};

type Handoff = {
  applicationId: string;
  token: string;
  expiresAt: number;
  applicationUrl: string;
};

export function BrowserAssist() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/applications");
    const payload = await response.json() as { applications?: Application[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load application packets");
    setApplications((payload.applications ?? []).filter((item) => item.status === "ready_for_review" && !item.submittedAt));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load application packets")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createHandoff(application: Application) {
    setBusy(application.id); setError(""); setNotice(""); setHandoff(null);
    try {
      const response = await fetch("/api/applications/browser-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: application.id }),
      });
      const payload = await response.json() as { handoffToken?: string; handoffExpiresAt?: number; task?: { allowedUrl?: string }; error?: string };
      if (!response.ok || !payload.handoffToken || !payload.handoffExpiresAt || !payload.task?.allowedUrl) throw new Error(payload.error ?? "Unable to create browser handoff");
      setHandoff({ applicationId: application.id, token: payload.handoffToken, expiresAt: payload.handoffExpiresAt, applicationUrl: payload.task.allowedUrl });
      setNotice("Short-lived handoff created. Open the exact application page and load this token in Scout Safe Fill. Verified profile fields can fill immediately; generated text stays locked until you review and approve each answer.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create browser handoff"); }
    finally { setBusy(null); }
  }

  async function copyToken() {
    if (!handoff) return;
    try {
      await navigator.clipboard.writeText(handoff.token);
      setNotice("Handoff token copied. It contains no profile answers and expires shortly.");
    } catch { setError("Clipboard access failed. Copy the token manually."); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / BROWSER ASSIST</p><h1>Fill the boring fields. Review the meaningful ones.</h1><p>Generate a short-lived task for one reviewed application. The extension fills verified profile fields, inspects non-sensitive free-text questions, and shows claim-backed drafts for your explicit approval before insertion. CAPTCHA, sensitive questions, file uploads and final submit stay with you.</p></div>
      <div className={styles.links}><Link href="/applications">Application Workspace</Link><Link href="/readiness">Application Readiness</Link><Link href="/">Dashboard</Link><Link href="/inbox">Internship Inbox</Link><Link href="/review">Review Queue</Link><Link href="/voice">Voice</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    {handoff && <section className={styles.handoff}>
      <div><p className={styles.kicker}>EXTENSION HANDOFF</p><h2>Valid until {new Date(handoff.expiresAt).toLocaleTimeString()}</h2><p>Open the exact application page below before loading this token in the extension.</p></div>
      <textarea readOnly value={handoff.token} aria-label="Scout extension handoff token" />
      <div className={styles.actions}><button onClick={() => void copyToken()}>Copy token</button><a href={handoff.applicationUrl} target="_blank" rel="noreferrer">Open application ↗</a></div>
    </section>}

    <section className={styles.listHead}><div><p className={styles.kicker}>READY APPLICATIONS</p><h2>{applications.length} packet(s)</h2></div><p>Only current `ready_for_review` packets without a recorded external submission can create a browser task.</p></section>
    <section className={styles.list}>
      {!applications.length && <div className={styles.empty}>No application packet is ready for browser assistance yet. Open Application Workspace or Readiness to see exactly what each role needs next.</div>}
      {applications.map((application) => <article className={styles.card} key={application.id}>
        <div><p className={styles.source}>{application.submittedFields.channel?.label ?? "Application"} · packet v{application.artifactVersion}</p><h3>{application.job?.company ?? "Unknown company"} — {application.job?.title ?? "Role"}</h3><p>{application.blockers.length ? `${application.blockers.length} blocker(s)` : "Verified reusable fields are ready. If the live form has non-sensitive free-text questions, Scout can propose evidence-bound answers that remain unfillable until you approve them in the extension."}</p></div>
        <button disabled={busy === application.id} onClick={() => void createHandoff(application)}>{busy === application.id ? "Creating…" : "Create extension handoff"}</button>
      </article>)}
    </section>

    <section className={styles.safety}><strong>Still manual:</strong> work authorization, visa/sponsorship, salary, availability, demographics, consent/signature, CAPTCHA, file uploads and final Submit. Editing an AI draft is treated as your explicit input and requires approval again before fill.</section>
  </main>;
}
