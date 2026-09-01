"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildRoleTimeline, type RoleTimelineEvent } from "../../../../lib/scout/role-timeline";
import styles from "./timeline.module.css";

type Job = { id: string; company: string; title: string; currentSnapshotId: string | null; lastSeenAt: string; postedAt: string | null };
type Application = { id: string; jobId: string; status: string; createdAt?: string | null; updatedAt?: string | null; submittedAt: string | null };
type Contact = { id: string; jobId: string; email: string; sourceUrl: string; reviewState: string; extractedAt?: string | null };
type Revision = { id: string; version: number; createdAt?: string | null };
type Draft = { id: string; jobId: string; state: string; approvedAt?: string | null; rejectedAt?: string | null; updatedAt?: string | null; revisions?: Revision[] };

function when(event: RoleTimelineEvent) {
  if (!event.occurredAt) return "Time not separately recorded";
  const date = new Date(event.occurredAt);
  return Number.isNaN(date.getTime()) ? event.occurredAt : date.toLocaleString();
}

export function RoleTimeline({ jobId }: { jobId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([fetch("/api/jobs"), fetch("/api/applications"), fetch("/api/contacts"), fetch("/api/outreach")])
        .then(async (responses) => {
          const payloads = await Promise.all(responses.map((response) => response.json())) as Array<Record<string, unknown>>;
          const failed = responses.findIndex((response) => !response.ok);
          if (failed >= 0) throw new Error(typeof payloads[failed].error === "string" ? payloads[failed].error : "Unable to load role timeline");
          setJobs((payloads[0].jobs as Job[] | undefined) ?? []);
          setApplications((payloads[1].applications as Application[] | undefined) ?? []);
          setContacts((payloads[2].contacts as Contact[] | undefined) ?? []);
          setDrafts((payloads[3].drafts as Draft[] | undefined) ?? []);
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load role timeline"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const model = useMemo(() => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return null;
    return {
      job,
      events: buildRoleTimeline({
        job,
        application: applications.find((item) => item.jobId === jobId) ?? null,
        contacts: contacts.filter((item) => item.jobId === jobId),
        drafts: drafts.filter((item) => item.jobId === jobId),
      }),
    };
  }, [applications, contacts, drafts, jobId, jobs]);

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / ROLE TIMELINE</p><h1>{model ? `${model.job.company} · ${model.job.title}` : "Role timeline"}</h1><p>Evidence, preparation, explicit external actions and recorded outcomes in one place.</p></div>
      <div className={styles.links}><Link href={`/roles/${jobId}`}>Role cockpit</Link><Link href="/outcomes">Outcomes</Link><Link href="/">Dashboard</Link></div>
    </header>
    <aside className={styles.boundary}><strong>Timeline ≠ inbox surveillance.</strong> Scout does not infer email delivery, recruiter replies or employer actions. Those appear only when explicitly recorded.</aside>
    {error && <div className={styles.error}>{error}</div>}
    {!error && model && <ol className={styles.timeline}>
      {model.events.length === 0 && <li className={styles.empty}>No timeline events recorded for this role yet.</li>}
      {model.events.map((event) => <li key={event.id} className={styles.event}>
        <div className={styles.dot} aria-hidden="true" />
        <div><span className={styles.time}>{when(event)}</span><h2>{event.label}</h2><p>{event.detail}</p><small>{event.evidence.replace(/_/g, " ")}</small></div>
      </li>)}
    </ol>}
    {!error && !model && <div className={styles.empty}>Loading role timeline…</div>}
  </main>;
}
