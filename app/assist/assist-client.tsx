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
      setNotice("Short-lived handoff created. For extension-free fill, copy this token and run npm run scout:fill on your Windows PC; it opens an isolated Edge window. Verified identity fields can fill with your confirmation. Claims, sensitive answers, uploads and Submit stay manual.");
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
      <div><p className={styles.kicker}>SCOUT / BROWSER ASSIST</p><h1>Fill the boring fields. Review the meaningful ones.</h1><p>Prepare a reviewed application for extension-free desktop Safe Fill. Scout launches a separate local Edge window, fills only verified profile fields after your confirmation, and leaves claim drafting, eligibility answers, CAPTCHA, file uploads and final Submit to you.</p></div>
      <div className={styles.links}><Link href="/applications">Application Workspace</Link><Link href="/readiness">Application Readiness</Link><Link href="/">Dashboard</Link><Link href="/inbox">Internship Inbox</Link><Link href="/review">Review Queue</Link><Link href="/voice">Voice</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    {handoff && <section className={styles.handoff}>
      <div><p className={styles.kicker}>DESKTOP SAFE FILL HANDOFF</p><h2>Valid until {new Date(handoff.expiresAt).toLocaleTimeString()}</h2><p>No extension needed. Copy this short-lived token, open a terminal in your local Scout repo, run npm run scout:fill, and paste it. Scout opens the approved application in its own Edge window.</p></div>
      <textarea readOnly value={handoff.token} aria-label="Scout extension handoff token" />
      <div className={styles.actions}><button onClick={() => void copyToken()}>Copy token for desktop fill</button><a href={handoff.applicationUrl} target="_blank" rel="noreferrer">Open manually ↗</a></div>
    </section>}

    <section className={styles.listHead}><div><p className={styles.kicker}>READY APPLICATIONS</p><h2>{applications.length} packet(s)</h2></div><p>Only current `ready_for_review` packets without a recorded external submission can start local Safe Fill.</p></section>
    <section className={styles.list}>
      {!applications.length && <div className={styles.empty}>No application packet is ready for browser assistance yet. Open Application Workspace or Readiness to see exactly what each role needs next.</div>}
      {applications.map((application) => <article className={styles.card} key={application.id}>
        <div><p className={styles.source}>{application.submittedFields.channel?.label ?? "Application"} · packet v{application.artifactVersion}</p><h3>{application.job?.company ?? "Unknown company"} — {application.job?.title ?? "Role"}</h3><p>{application.blockers.length ? `${application.blockers.length} blocker(s)` : "Verified reusable fields are available for reviewed desktop Safe Fill. Claim-backed text and application-specific answers remain manual in this extension-free mode."}</p></div>
        <button disabled={busy === application.id} onClick={() => void createHandoff(application)}>{busy === application.id ? "Creating…" : "Create desktop fill handoff"}</button>
      </article>)}
    </section>

    <section className={styles.safety}><strong>Desktop mode:</strong> run <code>npm run scout:fill</code> in your local repository (Node.js 22+ and Microsoft Edge). It will request this token and open a temporary Edge window. No Zen extension is required. Still manual: work authorization, availability, demographics, consent, CAPTCHA, file uploads, claim-backed responses and final Submit.</section>
  </main>;
}
