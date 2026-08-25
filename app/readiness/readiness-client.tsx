"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { assessApplicationReadiness, type ApplicationReadinessStatus } from "../../lib/scout/application-readiness";
import styles from "./readiness.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  canonicalUrl: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
};

type Claim = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
};

type ProfileField = {
  id: string;
  kind: string;
  claim: string;
  evidence: string;
  verified: boolean;
};

type Application = {
  id: string;
  jobId: string;
  status: string;
  artifactVersion: number;
  blockers: string[];
  submittedFields: Record<string, unknown>;
};

type Filter = "All" | "Shortlisted" | "Ready" | "Needs input" | "Blocked";
const filters: Filter[] = ["All", "Shortlisted", "Ready", "Needs input", "Blocked"];

export function ApplicationReadinessWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [profileFields, setProfileFields] = useState<ProfileField[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const [jobsResponse, claimsResponse, profileResponse, applicationsResponse] = await Promise.all([
        fetch("/api/jobs"),
        fetch("/api/claims"),
        fetch("/api/profile"),
        fetch("/api/applications"),
      ]);
      const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
      const claimsPayload = await claimsResponse.json() as { claims?: Claim[]; error?: string };
      const profilePayload = await profileResponse.json() as { fields?: ProfileField[]; error?: string };
      const applicationsPayload = await applicationsResponse.json() as { applications?: Application[]; error?: string };
      if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
      if (!claimsResponse.ok) throw new Error(claimsPayload.error ?? "Unable to load claims");
      if (!profileResponse.ok) throw new Error(profilePayload.error ?? "Unable to load profile evidence");
      if (!applicationsResponse.ok) throw new Error(applicationsPayload.error ?? "Unable to load application packets");
      setJobs(jobsPayload.jobs ?? []);
      setClaims(claimsPayload.claims ?? []);
      setProfileFields(profilePayload.fields ?? []);
      setApplications(applicationsPayload.applications ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load application readiness");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(() => jobs
    .filter((job) => job.lifecycleState === "active" && job.state !== "rejected")
    .map((job) => ({
      job,
      application: applications.find((application) => application.jobId === job.id) ?? null,
      readiness: assessApplicationReadiness({ job, profileFields, claims }),
    }))
    .sort((left, right) => right.readiness.score - left.readiness.score || left.job.company.localeCompare(right.job.company)),
  [jobs, claims, profileFields, applications]);

  const visible = useMemo(() => rows.filter(({ job, readiness }) => {
    if (filter === "Shortlisted") return job.state === "shortlisted";
    if (filter === "Ready") return readiness.status === "ready";
    if (filter === "Needs input") return readiness.status === "almost_ready" || readiness.status === "needs_setup";
    if (filter === "Blocked") return readiness.status === "blocked";
    return true;
  }), [rows, filter]);

  const counts = useMemo(() => ({
    ready: rows.filter(({ readiness }) => readiness.status === "ready").length,
    almost: rows.filter(({ readiness }) => readiness.status === "almost_ready").length,
    setup: rows.filter(({ readiness }) => readiness.status === "needs_setup").length,
    blocked: rows.filter(({ readiness }) => readiness.status === "blocked").length,
  }), [rows]);

  async function prepare(jobId: string) {
    setBusy(jobId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const payload = await response.json() as { application?: { status?: string; artifactVersion?: number }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to prepare application packet");
      setNotice(`Application packet v${payload.application?.artifactVersion ?? "?"} prepared (${payload.application?.status ?? "review required"}). No submission was attempted.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to prepare application packet");
    } finally { setBusy(null); }
  }

  if (loading) return <main className={styles.shell}><p>Loading application readiness…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / APPLICATION READINESS</p>
        <h1>Know what is actually ready before opening the form.</h1>
        <p>Scout checks immutable job evidence, verified reusable profile fields, approved role-relevant claims and the application channel. Legal and sensitive questions remain yours every time.</p>
      </div>
      <div className={styles.links}><Link href="/shortlist">Shortlist</Link><Link href="/assist">Safe Fill</Link><Link href="/">Dashboard</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary}>
      <div><strong>{counts.ready}</strong><span>Ready</span></div>
      <div><strong>{counts.almost}</strong><span>Almost ready</span></div>
      <div><strong>{counts.setup}</strong><span>Needs setup</span></div>
      <div><strong>{counts.blocked}</strong><span>Blocked</span></div>
    </section>

    <section className={styles.filters}>{filters.map((item) => <button key={item} className={filter === item ? styles.active : ""} onClick={() => setFilter(item)}>{item}</button>)}</section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>No applications match this readiness view.</div>}
      {visible.map(({ job, readiness, application }) => {
        const safeFillUnlocked = readiness.status === "ready" && application?.status === "ready_for_review";
        return <article className={styles.card} key={job.id}>
          <div className={styles.cardHead}>
            <div><p className={styles.company}>{job.company}</p><h2>{job.title}</h2><p className={styles.meta}>{job.location || "Location unspecified"} · {readiness.channel.label}</p></div>
            <div className={`${styles.score} ${styles[readiness.status as ApplicationReadinessStatus]}`}><strong>{readiness.score}</strong><span>{readiness.label}</span></div>
          </div>

          <div className={styles.packetLine}><span>{application ? `Current packet v${application.artifactVersion} · ${application.status.replace(/_/g, " ")}` : "No application packet prepared yet"}</span><span>{readiness.profileSummary}</span></div>

          <div className={styles.columns}>
            <div>
              <strong>Reusable evidence</strong>
              <p>Verified required fields: {readiness.verifiedRequiredKeys.length}/{readiness.requiredProfileCount}</p>
              {readiness.missingProfileLabels.length ? <p className={styles.warning}>Missing: {readiness.missingProfileLabels.join(", ")}</p> : <p className={styles.good}>All required reusable profile fields are verified.</p>}
              <p>Optional verified fields: {readiness.optionalVerifiedKeys.length ? readiness.optionalVerifiedKeys.join(", ") : "none"}</p>
            </div>
            <div>
              <strong>Role-specific claims</strong>
              {readiness.supportingClaims.length ? readiness.supportingClaims.map((support) => <p key={support.theme}>{support.theme}: <code>{support.claimIds.join(", ")}</code></p>) : <p className={styles.warning}>No approved role-relevant claim is currently supporting this application.</p>}
            </div>
          </div>

          {readiness.blockers.length > 0 && <div className={styles.blockers}><strong>What is stopping Safe Fill</strong>{readiness.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}</div>}

          <div className={styles.next}><strong>Next action</strong>{readiness.nextActions.map((action) => <span key={action}>{action}</span>)}</div>

          <details className={styles.manual}><summary>Questions Scout will never silently reuse</summary><p>{readiness.manualConfirmations.join(" · ")}</p><p>CAPTCHA, file-upload choices and the final Submit action also stay manual.</p></details>

          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy === job.id || !job.currentSnapshotId} onClick={() => void prepare(job.id)}>{busy === job.id ? "Preparing…" : application ? "Refresh packet" : "Prepare packet"}</button>
            {safeFillUnlocked ? <Link className={styles.safeFill} href="/assist">Open Safe Fill →</Link> : <button disabled title="Prepare a ready_for_review packet first">Safe Fill locked</button>}
            <a href={job.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a>
            <Link href="/">Profile & Claims</Link>
          </div>
        </article>;
      })}
    </section>

    <footer className={styles.boundary}>Readiness is evidence-based. Scout does not infer legal answers, upload files, submit applications or send messages.</footer>
  </main>;
}
