"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./roles.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  location: string;
  workplaceType: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  postedAt: string | null;
  lastSeenAt: string;
};

type Application = {
  jobId: string;
  status: string;
  submittedAt: string | null;
  artifactVersion: number;
};

export function RoleIndexWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [jobsResponse, applicationsResponse] = await Promise.all([fetch("/api/jobs"), fetch("/api/applications")]);
    const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
    const applicationsPayload = await applicationsResponse.json() as { applications?: Application[]; error?: string };
    if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load roles");
    if (!applicationsResponse.ok) throw new Error(applicationsPayload.error ?? "Unable to load application state");
    setJobs(jobsPayload.jobs ?? []);
    setApplications(applicationsPayload.applications ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load roles")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(() => jobs
    .filter((job) => {
      if (!query.trim()) return true;
      return `${job.company} ${job.title} ${job.location}`.toLowerCase().includes(query.trim().toLowerCase());
    })
    .sort((left, right) => {
      if (left.lifecycleState !== right.lifecycleState) return left.lifecycleState === "active" ? -1 : 1;
      if (left.state !== right.state) {
        const order = { shortlisted: 0, saved: 1, rejected: 2 } as const;
        return order[left.state] - order[right.state];
      }
      return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    }), [jobs, query]);

  if (loading) return <main className={styles.shell}><p>Loading roles…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / ROLE COCKPITS</p><h1>One role. Every decision axis.</h1><p>Open a role to inspect fit, opportunity quality, preference signal, application readiness, deadlines, progress, contact evidence and outreach without collapsing them into one magic score.</p></div>
      <div className={styles.links}><Link href="/shortlist">Shortlist</Link><Link href="/applications">Applications</Link><Link href="/">Dashboard</Link></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.controls}><input aria-label="Search roles" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, role, location" /><span>{visible.length} role(s)</span></section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>No roles match this view.</div>}
      {visible.map((job) => {
        const application = applications.find((item) => item.jobId === job.id) ?? null;
        return <article className={styles.card} key={job.id}>
          <div><p className={styles.company}>{job.company}</p><h2>{job.title}</h2><p className={styles.meta}>{job.location || "Location unspecified"} · {job.workplaceType || "Workplace unspecified"}</p></div>
          <div className={styles.tags}><span>{job.state}</span><span>{job.lifecycleState}</span><span>{job.currentSnapshotId ? "Official snapshot" : "Needs official snapshot"}</span><span>{application ? `Packet v${application.artifactVersion}` : "No packet"}</span>{application?.submittedAt && <span>Submitted externally</span>}</div>
          <Link className={styles.open} href={`/roles/${encodeURIComponent(job.id)}`}>Open decision cockpit →</Link>
        </article>;
      })}
    </section>

    <footer className={styles.boundary}>Role cockpits are read-only decision surfaces. Scout still does not submit applications or send outreach automatically.</footer>
  </main>;
}
