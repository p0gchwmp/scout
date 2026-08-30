"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assessOpportunityFit,
  type OpportunityFitAssessment,
  type OpportunityPriority,
} from "../../lib/scout/opportunity-fit";
import {
  assessOpportunityQuality,
  type OpportunityQualityAssessment,
  type OpportunityQualitySource,
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

type Filter = "attention" | "all" | OpportunityPriority;
type Row = { job: Job; quality: OpportunityQualityAssessment; fit: OpportunityFitAssessment };

const filters: Array<{ id: Filter; label: string }> = [
  { id: "attention", label: "Attention first" },
  { id: "A", label: "Priority A" },
  { id: "B", label: "Priority B" },
  { id: "C", label: "Priority C" },
  { id: "parked", label: "Parked" },
  { id: "all", label: "All" },
];

const priorityOrder: Record<OpportunityPriority, number> = { A: 0, B: 1, C: 2, parked: 3 };

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

function summerLabel(status: OpportunityFitAssessment["summer2027"]) {
  return status === "exact" ? "Summer 2027: exact" : `Summer 2027: ${status}`;
}

function collegeLabel(status: OpportunityFitAssessment["collegeCompatibility"]) {
  return status === "compatible" ? "College-now: compatible" : status === "mismatch" ? "College-now: mismatch" : "College-now: unknown";
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
      .map((job) => {
        const quality = assessOpportunityQuality(job, job.sourceRegistryId ? sourceById.get(job.sourceRegistryId) ?? null : null, now);
        return { job, quality, fit: assessOpportunityFit(job, quality, now) };
      })
      .sort((left, right) => priorityOrder[left.fit.priority] - priorityOrder[right.fit.priority]
        || right.quality.score - left.quality.score
        || (left.fit.freshness.daysOld ?? Number.MAX_SAFE_INTEGER) - (right.fit.freshness.daysOld ?? Number.MAX_SAFE_INTEGER)
        || left.job.company.localeCompare(right.job.company));
  }, [jobs, sources]);

  const visible = useMemo(() => rows.filter(({ job, quality, fit }) => {
    const text = `${job.company} ${job.title} ${job.location} ${job.description} ${quality.companyDomain ?? ""} ${fit.timingLane} ${fit.roleFit} ${fit.priority}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (filter === "attention") return fit.priority !== "A";
    if (filter !== "all") return fit.priority === filter;
    return true;
  }), [rows, filter, query]);

  const summary = useMemo(() => ({
    a: rows.filter(({ fit }) => fit.priority === "A").length,
    b: rows.filter(({ fit }) => fit.priority === "B").length,
    c: rows.filter(({ fit }) => fit.priority === "C").length,
    parked: rows.filter(({ fit }) => fit.priority === "parked").length,
  }), [rows]);

  if (loading) return <main className={styles.shell}><p>Loading opportunity intelligence…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / OPPORTUNITY INTELLIGENCE</p>
        <h1>Evidence first. Then timing, eligibility and priority.</h1>
        <p>Scout classifies only persisted posting evidence without certifying a company as legitimate, inventing compensation, or changing your resume-fit score. Missing dates, hours or eligibility stay unknown rather than becoming a rejection. Remote alone never proves alongside-college compatibility.</p>
      </div>
      <div className={styles.headerLinks}><Link href="/shortlist">Shortlist</Link><Link href="/review">Review queue</Link><Link href="/sources">Source health</Link><Link href="/">Dashboard</Link></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.summary}>
      <div><strong>{rows.length}</strong><span>Active opportunities</span></div>
      <div><strong>{summary.a}</strong><span>Priority A</span></div>
      <div><strong>{summary.b}</strong><span>Priority B</span></div>
      <div><strong>{summary.c}</strong><span>Priority C</span></div>
      <div><strong>{summary.parked}</strong><span>Parked</span></div>
    </section>

    <section className={styles.controls}>
      <div className={styles.filters}>{filters.map((item) => <button key={item.id} className={filter === item.id ? styles.active : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
      <input aria-label="Search opportunity intelligence" placeholder="Search company, role, location, lane…" value={query} onChange={(event) => setQuery(event.target.value)} />
    </section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>No opportunities match this priority view.</div>}
      {visible.map(({ job, quality, fit }) => <article className={styles.card} key={job.id}>
        <div className={styles.topline}>
          <div>
            <p className={styles.company}>{job.company}</p>
            <h2>{job.title}</h2>
            <p className={styles.meta}>{job.location || "Location unspecified"} · {job.source} · Posted {formatDate(job.postedAt)}</p>
          </div>
          <div className={`${styles.score} ${styles[quality.tier]}`}><strong>{fit.priorityLabel}</strong><span>{quality.label} · evidence {quality.score}/100</span></div>
        </div>

        <div className={styles.chips}>
          <span>{fit.roleFit === "stretch" ? "Role fit: Stretch" : `Role fit: ${fit.roleFit}`}</span>
          <span>{summerLabel(fit.summer2027)}</span>
          <span>{collegeLabel(fit.collegeCompatibility)}</span>
          <span>Eligibility: {fit.eligibility}</span>
          <span>Freshness: {fit.freshness.status}{fit.freshness.daysOld === null ? "" : ` · ${fit.freshness.daysOld}d`}</span>
          <span>{quality.evidenceLabel}</span>
          <span>{compensationLabel(quality)}</span>
        </div>

        <section className={styles.evidenceGrid}>
          <div><strong>Priority decision</strong>{fit.priorityReasons.map((reason) => <p key={reason}>{reason}</p>)}<p>Timing lane: {fit.timingLane.replaceAll("_", " ")}</p><p>{fit.roleReason}</p></div>
          <div><strong>Scheduling fit</strong><p>{fit.summerReason}</p><p>{fit.collegeReason}</p><p>{fit.duration.text ? `Duration: ${fit.duration.text}` : "Duration: unknown"}</p><p>{fit.dateWindow.start && fit.dateWindow.end ? `Dates: ${fit.dateWindow.start} → ${fit.dateWindow.end}` : "Exact internship dates: unknown"}</p><p>{fit.hoursPerWeek.max !== null ? `Hours: ${fit.hoursPerWeek.min === fit.hoursPerWeek.max ? fit.hoursPerWeek.max : `${fit.hoursPerWeek.min}–${fit.hoursPerWeek.max}`} per week` : "Weekly hours: unknown"}</p></div>
        </section>

        <section className={styles.evidenceGrid}>
          <div><strong>Eligibility</strong>{fit.eligibilityReasons.map((reason) => <p key={reason}>{reason}</p>)}{fit.unknowns.length > 0 && <p>Still unknown: {fit.unknowns.join(", ")}</p>}</div>
          <div><strong>Exact supporting excerpts</strong>{fit.evidence.length ? fit.evidence.map((item, index) => <p className={styles.quote} key={`${item.code}-${index}`}><b>{item.label}:</b> {item.excerpt}</p>) : <p>No decisive timing/eligibility excerpt was published. Scout keeps those fields unknown.</p>}</div>
        </section>

        <section className={styles.evidenceGrid}>
          <div><strong>Company / source evidence</strong><p>{quality.companyDomain ? `Domain: ${quality.companyDomain}` : "No verified company domain bound yet."}</p><p>{quality.officialSnapshot ? "Immutable official job snapshot captured." : "Official job snapshot still required."}</p><p>{quality.registeredSource ? "Job is bound to a registered Scout company source." : "No registered company source is bound yet."}</p>{quality.careersUrl && <a href={quality.careersUrl} target="_blank" rel="noreferrer">Careers / source page ↗</a>}</div>
          <div><strong>Published internship structure</strong>{quality.structureSignals.length ? quality.structureSignals.map((signal) => <p key={signal}>{signal}</p>) : <p>Scout found little explicit internship-structure detail in the persisted posting.</p>}{quality.compensation.text && <p className={styles.quote}>Compensation evidence: {quality.compensation.text}</p>}</div>
        </section>

        {quality.flags.length > 0 && <section className={styles.flags}><strong>Flags to review</strong>{quality.flags.map((flag) => <div key={flag.code} className={styles[flag.severity]}><b>{flag.label}</b><span>{flag.evidence}</span></div>)}</section>}

        <section className={styles.caveats}><strong>What Scout is not assuming</strong>{quality.caveats.map((item) => <p key={item}>{item}</p>)}{fit.unknowns.length > 0 && <p>Unknown scheduling or eligibility facts are not treated as mismatches.</p>}</section>

        <div className={styles.actions}><a href={job.canonicalUrl} target="_blank" rel="noreferrer">Open posting ↗</a><Link href="/shortlist">Review resume fit →</Link><Link href="/review">Human review queue →</Link></div>
      </article>)}
    </section>

    <footer className={styles.boundary}>Priority is a review queue, not an autonomous decision. No role is auto-rejected. Parked opportunities remain visible; Scout does not send outreach or submit applications.</footer>
  </main>;
}
