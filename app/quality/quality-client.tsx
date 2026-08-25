"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assessOpportunityQuality,
  type OpportunityQualityAssessment,
  type OpportunityQualitySource,
  type OpportunityQualityTier,
} from "../../lib/scout/opportunity-quality-intelligence";
import styles from "./quality.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  source: string;
  sourceRegistryId: string | null;
  canonicalUrl: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  postedAt: string | null;
  lastSeenAt: string;
};

type Source = OpportunityQualitySource & {
  registered: boolean;
  enabled: boolean;
  health?: { state?: string; label?: string; reason?: string } | null;
};

type Filter = "attention" | "all" | OpportunityQualityTier;
type Row = { job: Job; quality: OpportunityQualityAssessment };

const filters: Array<{ id: Filter; label: string }> = [
  { id: "attention", label: "Attention first" },
  { id: "strong_evidence", label: "Strong evidence" },
  { id: "review", label: "Needs review" },
  { id: "red_flag", label: "Red flags" },
  { id: "low_signal", label: "Low signal" },
  { id: "all", label: "All" },
];

const tierOrder: Record<OpportunityQualityTier, number> = {
  red_flag: 0,
  low_signal: 1,
  review: 2,
  strong_evidence: 3,
};

function compensationLabel(quality: OpportunityQualityAssessment) {
  const labels: Record<OpportunityQualityAssessment["compensation"]["status"], string> = {
    explicit_paid: "Published pay / stipend",
    explicit_unpaid: "Explicitly unpaid",
    commission_only: "Commission-only",
    mentioned: "Compensation mentioned",
    not_published: "Compensation not published",
  };
  return labels[quality.compensation.status];
}

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : parsed.toLocaleDateString();
}

export function OpportunityQualityWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [jobsResponse, sourcesResponse] = await Promise.all([
        fetch("/api/jobs"),
        fetch("/api/sources"),
      ]);
      const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
      const sourcesPayload = await sourcesResponse.json() as { sources?: Source[]; error?: string };
      if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
      if (!sourcesResponse.ok) throw new Error(sourcesPayload.error ?? "Unable to load source evidence");
      setJobs(jobsPayload.jobs ?? []);
      setSources(sourcesPayload.sources ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load opportunity quality");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo<Row[]>(() => {
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const now = new Date();
    return jobs
      .filter((job) => job.lifecycleState === "active" && job.state !== "rejected")
      .map((job) => ({
        job,
        quality: assessOpportunityQuality(job, job.sourceRegistryId ? sourceById.get(job.sourceRegistryId) ?? null : null, now),
      }))
      .sort((left, right) => tierOrder[left.quality.tier] - tierOrder[right.quality.tier]
        || left.quality.score - right.quality.score
        || left.job.company.localeCompare(right.job.company));
  }, [jobs, sources]);

  const visible = useMemo(() => rows.filter(({ job, quality }) => {
    const text = `${job.company} ${job.title} ${job.location} ${job.description} ${quality.companyDomain ?? ""}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (filter === "attention") return quality.tier !== "strong_evidence";
    if (filter !== "all") return quality.tier === filter;
    return true;
  }), [rows, filter, query]);

  const summary = useMemo(() => ({
    strong: rows.filter(({ quality }) => quality.tier === "strong_evidence").length,
    review: rows.filter(({ quality }) => quality.tier === "review").length,
    red: rows.filter(({ quality }) => quality.tier === "red_flag").length,
    low: rows.filter(({ quality }) => quality.tier === "low_signal").length,
  }), [rows]);

  if (loading) return <main className={styles.shell}><p>Loading opportunity quality…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / OPPORTUNITY QUALITY</p>
        <h1>Fit is one question. Is the opportunity worth trusting is another.</h1>
        <p>Scout reads only persisted official-job and source evidence here. It surfaces published structure and red flags without certifying a company as legitimate, inventing compensation, or changing your resume-fit score.</p>
      </div>
      <div className={styles.headerLinks}><Link href="/shortlist">Shortlist</Link><Link href="/sources">Source health</Link><Link href="/">Dashboard</Link></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.summary}>
      <div><strong>{rows.length}</strong><span>Active opportunities</span></div>
      <div><strong>{summary.strong}</strong><span>Strong evidence</span></div>
      <div><strong>{summary.review}</strong><span>Needs review</span></div>
      <div><strong>{summary.red}</strong><span>Red flags</span></div>
      <div><strong>{summary.low}</strong><span>Low signal</span></div>
    </section>

    <section className={styles.controls}>
      <div className={styles.filters}>{filters.map((item) => <button key={item.id} className={filter === item.id ? styles.active : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      <input aria-label="Search opportunity quality" placeholder="Search company, role, location…" value={query} onChange={(event) => setQuery(event.target.value)} />
    </section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>No opportunities match this quality view.</div>}
      {visible.map(({ job, quality }) => <article className={styles.card} key={job.id}>
        <div className={styles.topline}>
          <div>
            <p className={styles.company}>{job.company}</p>
            <h2>{job.title}</h2>
            <p className={styles.meta}>{job.location || "Location unspecified"} · {job.source} · Posted {formatDate(job.postedAt)}</p>
          </div>
          <div className={`${styles.score} ${styles[quality.tier]}`}><strong>{quality.score}</strong><span>{quality.label}</span></div>
        </div>

        <div className={styles.chips}>
          <span>{quality.evidenceLabel}</span>
          <span>{quality.provider}</span>
          <span>{compensationLabel(quality)}</span>
          <span>{quality.duration ? `Duration: ${quality.duration}` : "Duration not published"}</span>
          <span>{quality.arrangement === "unspecified" ? "Work mode not published" : `Work mode: ${quality.arrangement}`}</span>
        </div>

        <section className={styles.evidenceGrid}>
          <div><strong>Company / source evidence</strong><p>{quality.companyDomain ? `Domain: ${quality.companyDomain}` : "No verified company domain bound yet."}</p><p>{quality.officialSnapshot ? "Immutable official job snapshot captured." : "Official job snapshot still required."}</p><p>{quality.registeredSource ? "Job is bound to a registered Scout company source." : "No registered company source is bound yet."}</p>{quality.careersUrl && <a href={quality.careersUrl} target="_blank" rel="noreferrer">Careers / source page ↗</a>}</div>
          <div><strong>Published internship structure</strong>{quality.structureSignals.length ? quality.structureSignals.map((signal) => <p key={signal}>{signal}</p>) : <p>Scout found little explicit internship-structure detail in the persisted posting.</p>}{quality.compensation.text && <p className={styles.quote}>Compensation evidence: {quality.compensation.text}</p>}</div>
        </section>

        {quality.flags.length > 0 && <section className={styles.flags}><strong>Flags to review</strong>{quality.flags.map((flag) => <div key={flag.code} className={styles[flag.severity]}><b>{flag.label}</b><span>{flag.evidence}</span></div>)}</section>}

        <section className={styles.caveats}><strong>What Scout is not assuming</strong>{quality.caveats.map((item) => <p key={item}>{item}</p>)}</section>

        <div className={styles.actions}><a href={job.canonicalUrl} target="_blank" rel="noreferrer">Open posting ↗</a><Link href="/shortlist">Review fit in Shortlist →</Link></div>
      </article>)}
    </section>

    <footer className={styles.boundary}>No role is auto-rejected from this workspace. Quality intelligence is a review aid built from persisted evidence, not a company-legitimacy certification service.</footer>
  </main>;
}
