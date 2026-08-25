"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SourceHealthState } from "../../lib/scout/source-health";
import styles from "./sources.module.css";

type SourceHealth = {
  state: SourceHealthState;
  label: string;
  reason: string;
  latestObservedAt: string | null;
  latestAgeDays: number | null;
  lastSuccessfulAt: string | null;
  lastSuccessAgeDays: number | null;
  activeJobs: number;
  totalJobs: number;
  lastJobSeenAt: string | null;
  latestRun: {
    status: "running" | "completed" | "failed";
    observedAt: string;
    completedAt: string | null;
    discoveredCount: number;
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    closedCount: number;
    error: string | null;
  } | null;
};

type Source = {
  id: string;
  provider: string;
  boardToken: string;
  companyName: string;
  companyDomain: string;
  careersUrl: string | null;
  sourceUrl: string | null;
  focus: string;
  enabled: boolean;
  registered: boolean;
  catalogEntry: boolean;
  createdAt: string | null;
  health: SourceHealth;
};

type Filter = "All" | "Healthy" | "Attention" | "Stale" | "Not checked" | "Disabled";
const filters: Filter[] = ["All", "Healthy", "Attention", "Stale", "Not checked", "Disabled"];

function displayDate(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function matchesFilter(source: Source, filter: Filter) {
  if (filter === "Healthy") return source.health.state === "healthy" || source.health.state === "running";
  if (filter === "Attention") return source.health.state === "degraded" || source.health.state === "needs_review";
  if (filter === "Stale") return source.health.state === "stale";
  if (filter === "Not checked") return source.health.state === "not_checked";
  if (filter === "Disabled") return source.health.state === "disabled";
  return true;
}

export function SourceHealthWorkspace() {
  const [sources, setSources] = useState<Source[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/sources", { cache: "no-store" });
      const payload = await response.json() as { sources?: Source[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load source health");
      setSources(payload.sources ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load source health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => ({
    catalog: sources.filter((source) => source.catalogEntry).length,
    healthy: sources.filter((source) => source.health.state === "healthy" || source.health.state === "running").length,
    attention: sources.filter((source) => source.health.state === "degraded" || source.health.state === "needs_review").length,
    unchecked: sources.filter((source) => source.health.state === "not_checked").length,
  }), [sources]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sources
      .filter((source) => matchesFilter(source, filter))
      .filter((source) => !needle || `${source.companyName} ${source.provider} ${source.focus} ${source.companyDomain}`.toLowerCase().includes(needle))
      .sort((left, right) => {
        const rank: Record<SourceHealthState, number> = { needs_review: 0, degraded: 1, stale: 2, not_checked: 3, running: 4, healthy: 5, disabled: 6 };
        return rank[left.health.state] - rank[right.health.state] || left.companyName.localeCompare(right.companyName);
      });
  }, [sources, filter, query]);

  if (loading) return <main className={styles.shell}><p>Loading source health…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / DISCOVERY SOURCES</p>
        <h1>Know which feeds deserve trust.</h1>
        <p>Scout combines the controlled source catalog with persisted source observations and job counts. Health is diagnostic only: Scout never auto-removes or auto-disables a source because one public ATS request failed.</p>
      </div>
      <nav className={styles.links} aria-label="Source health navigation">
        <Link href="/inbox">Run Scout in Inbox</Link><Link href="/applications">Applications</Link><Link href="/">Dashboard</Link>
      </nav>
    </header>

    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary} aria-label="Source health summary">
      <button type="button" onClick={() => setFilter("All")} className={filter === "All" ? styles.activeSummary : ""}><strong>{counts.catalog}</strong><span>Controlled catalog</span></button>
      <button type="button" onClick={() => setFilter("Healthy")} className={filter === "Healthy" ? styles.activeSummary : ""}><strong>{counts.healthy}</strong><span>Healthy / checking</span></button>
      <button type="button" onClick={() => setFilter("Attention")} className={filter === "Attention" ? styles.activeSummary : ""}><strong>{counts.attention}</strong><span>Needs attention</span></button>
      <button type="button" onClick={() => setFilter("Not checked")} className={filter === "Not checked" ? styles.activeSummary : ""}><strong>{counts.unchecked}</strong><span>Not checked yet</span></button>
    </section>

    <section className={styles.legend}>
      <span><strong>Healthy</strong> last persisted check completed within 7 days</span>
      <span><strong>Stale</strong> last successful check is 7+ days old</span>
      <span><strong>Degraded</strong> most recent check failed temporarily</span>
      <span><strong>Review source</strong> 404/catalog/adapter evidence needs human review</span>
    </section>

    <section className={styles.controls}>
      <div className={styles.filters}>{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? styles.active : ""}>{item}</button>)}</div>
      <input aria-label="Search discovery sources" placeholder="Search company, ATS, focus" value={query} onChange={(event) => setQuery(event.target.value)} />
    </section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>No discovery sources match this view.</div>}
      {visible.map((source) => <article className={styles.card} key={source.id}>
        <div className={styles.topline}>
          <div>
            <p className={styles.company}>{source.companyName}</p>
            <h2>{source.provider} · {source.boardToken}</h2>
            <p className={styles.focus}>{source.focus}</p>
          </div>
          <div className={`${styles.health} ${styles[source.health.state]}`}><strong>{source.health.label}</strong><span>{source.catalogEntry ? "catalog" : "resolved"}{source.registered ? " · registered" : " · not registered yet"}</span></div>
        </div>

        <div className={styles.reason}><strong>{source.health.reason}</strong>{source.health.latestRun?.error && <span>{source.health.latestRun.error}</span>}</div>

        <div className={styles.metrics}>
          <div><strong>{source.health.activeJobs}</strong><span>active jobs</span></div>
          <div><strong>{source.health.totalJobs}</strong><span>known jobs</span></div>
          <div><strong>{source.health.latestRun?.discoveredCount ?? "—"}</strong><span>internships last check</span></div>
          <div><strong>{source.health.latestAgeDays ?? "—"}</strong><span>days since check</span></div>
        </div>

        <div className={styles.meta}>
          <span>Last check: {displayDate(source.health.latestObservedAt)}</span>
          <span>Last success: {displayDate(source.health.lastSuccessfulAt)}</span>
          <span>Last job seen: {displayDate(source.health.lastJobSeenAt)}</span>
          <span>Domain: {source.companyDomain}</span>
        </div>

        {source.health.latestRun && <details className={styles.runDetails}><summary>Latest persisted run details</summary><p>Status: {source.health.latestRun.status} · created {source.health.latestRun.createdCount} · updated {source.health.latestRun.updatedCount} · unchanged {source.health.latestRun.unchangedCount} · closed {source.health.latestRun.closedCount}</p></details>}

        <div className={styles.actions}>
          {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">Public ATS board ↗</a>}
          <a href={`https://${source.companyDomain}`} target="_blank" rel="noreferrer">Company site ↗</a>
          <Link href="/inbox">Run discovery →</Link>
        </div>
      </article>)}
    </section>

    <footer className={styles.boundary}>Source Health is evidence from Scout's persisted checks. A temporary ATS failure does not close jobs, disable a source, or authorize broader scraping. LinkedIn remains a lead/context surface, not an email-harvesting source.</footer>
  </main>;
}
