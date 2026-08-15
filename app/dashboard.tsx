"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Job = {
  id: string;
  sourceRegistryId: string | null;
  company: string;
  title: string;
  location: string;
  workplaceType: string;
  source: string;
  canonicalUrl: string;
  score: number;
  scoreExplanation: string[];
  eligibilityRisks: string[];
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  lastSeenAt: string;
};

type Source = {
  id: string;
  provider: "greenhouse";
  companyName: string;
  companyDomain: string;
  careersUrl: string | null;
  enabled: boolean;
};

type SyncRun = {
  id: string;
  sourceId: string;
  status: "running" | "completed" | "failed";
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  closedCount: number;
  completedAt: string | null;
};

const tabs = ["Jobs", "Sources"] as const;

export function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Jobs");
  const [filter, setFilter] = useState("Active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [jobsResponse, sourcesResponse] = await Promise.all([fetch("/api/jobs"), fetch("/api/sources")]);
      const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
      const sourcesPayload = await sourcesResponse.json() as { sources?: Source[]; recentRuns?: SyncRun[]; error?: string };
      if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
      if (!sourcesResponse.ok) throw new Error(sourcesPayload.error ?? "Unable to load sources");
      setJobs(jobsPayload.jobs ?? []);
      setSources(sourcesPayload.sources ?? []);
      setRuns(sourcesPayload.recentRuns ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Scout data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const visibleJobs = useMemo(() => jobs.filter((job) => {
    if (filter === "Active") return job.lifecycleState === "active" && job.state !== "rejected";
    if (filter === "Saved") return job.state === "saved";
    if (filter === "Closed") return job.lifecycleState === "closed";
    return true;
  }), [jobs, filter]);

  async function syncSource(source: Source) {
    setBusy(source.id);
    setNotice("");
    setError("");
    try {
      const idempotencyKey = `manual-${new Date().toISOString().slice(0, 13)}`;
      const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: source.id, idempotencyKey }) });
      const payload = await response.json() as { run?: SyncRun; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Sync failed");
      setNotice(`${source.companyName}: ${payload.run?.discoveredCount ?? 0} jobs observed; the same hourly key is safe to retry.`);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function updateJob(id: string, state: "shortlisted" | "saved" | "rejected") {
    setBusy(id);
    try {
      const response = await fetch("/api/jobs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, state }) });
      const payload = await response.json() as { job?: Job; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "Update failed");
      setJobs((items) => items.map((job) => job.id === id ? payload.job! : job));
      setNotice(`Job marked ${state}. No application or message was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function extractContacts(job: Job) {
    setBusy(job.id);
    try {
      const response = await fetch("/api/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const payload = await response.json() as { contacts?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Extraction failed");
      setNotice(`${payload.contacts?.length ?? 0} published business contact record(s) stored with provenance. Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Extraction failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Scout home"><span className="brand-mark">S</span><span>Scout</span></a>
        <nav className="main-nav" aria-label="Primary navigation">
          {tabs.map((tab) => <button key={tab} className={activeTab === tab ? "nav-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        </nav>
        <div className="header-actions"><span className="sync-dot"><i /> Persisted D1 data</span><button className="avatar" aria-label="Local MVP">MVP</button></div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">CONTROLLED DISCOVERY · PROVENANCE FIRST</p>
            <h1>Observed openings,<br /><em>not personalized rankings.</em></h1>
            <p className="hero-copy">Scout currently reads only registered Greenhouse boards and keeps immutable job snapshots. Jobs remain explicitly unranked until a persisted approved profile is configured. <strong>It cannot send messages or apply.</strong></p>
          </div>
          <div className="hero-stats" aria-label="Current persisted summary">
            <div><span>{jobs.filter((job) => job.lifecycleState === "active").length}</span><p>active jobs</p></div>
            <div><span>{sources.filter((source) => source.enabled).length}</span><p>enabled sources</p></div>
            <div><span>{runs.filter((run) => run.status === "completed").length}</span><p>recent syncs</p></div>
          </div>
        </section>

        {notice && <div className="notice" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        {error && <div className="notice error-notice" role="alert"><span>!</span>{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

        {activeTab === "Jobs" ? <>
          <section className="control-strip" aria-label="Job filters"><div className="filters">{["Active", "Saved", "Closed", "All"].map((item) => <button key={item} className={filter === item ? "filter-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="batch-actions"><span>{visibleJobs.length} persisted result(s)</span></div></section>
          <section className="queue-heading"><div><p className="section-kicker">CURRENT DATABASE</p><h2>Discovered jobs</h2></div><p>Composite source identity · versioned snapshots · lifecycle tracking</p></section>
          <section className="job-list" aria-label="Persisted jobs">
            {loading && <div className="empty-state">Loading persisted jobs…</div>}
            {!loading && !visibleJobs.length && <div className="empty-state">No jobs match this view. Register a Greenhouse source in D1, then sync it from the Sources tab.</div>}
            {visibleJobs.map((job) => <article className="job-card" key={job.id}>
              <div className="company-logo">{job.company.slice(0, 2).toUpperCase()}</div>
              <div className="job-main">
                <div className="job-title-row"><div><p className="company-name">{job.company}</p><h3>{job.title}</h3></div><span className="sync-dot">Unranked</span></div>
                <p className="job-meta"><span>⌖</span>{job.location || "Location unspecified"}<b>·</b>{job.workplaceType}<b>·</b>{job.source}<b>·</b>{job.lifecycleState}</p>
                <div className="reason-row">{job.scoreExplanation.map((reason) => <span className="reason" key={reason}>✓ {reason}</span>)}{job.eligibilityRisks.map((risk) => <span className="risk" key={risk}>! {risk}</span>)}</div>
              </div>
              <div className="card-actions"><button className="primary-action" disabled={busy === job.id || !job.currentSnapshotId} onClick={() => void extractContacts(job)}>Extract contacts</button><button className="ghost-action" disabled={busy === job.id} onClick={() => void updateJob(job.id, job.state === "saved" ? "shortlisted" : "saved")}>{job.state === "saved" ? "Unsave" : "Save"}</button><button className="ghost-action" disabled={busy === job.id} onClick={() => void updateJob(job.id, "rejected")}>Reject</button><a className="details-link" href={job.canonicalUrl} target="_blank" rel="noreferrer">Stored official URL ↗</a></div>
            </article>)}
          </section>
        </> : <>
          <section className="queue-heading"><div><p className="section-kicker">ALLOWLISTED REGISTRY</p><h2>Greenhouse sources</h2></div><p>Board tokens are never accepted by the sync endpoint.</p></section>
          <section className="source-list">
            {loading && <div className="empty-state">Loading registered sources…</div>}
            {!loading && !sources.length && <div className="empty-state">No controlled sources are registered. Add one directly to <code>company_sources</code> using the validated README procedure.</div>}
            {sources.map((source) => { const latest = runs.find((run) => run.sourceId === source.id); return <article className="source-card" key={source.id}><div><p className="company-name">{source.provider.toUpperCase()}</p><h3>{source.companyName}</h3><p>{source.companyDomain} · persisted posting content only</p><small>{latest ? `Last run: ${latest.status} · ${latest.discoveredCount} observed` : "Never synced"}</small></div><button className="primary-action" disabled={!source.enabled || busy === source.id} onClick={() => void syncSource(source)}>{busy === source.id ? "Syncing…" : "Sync registered source"}</button></article>; })}
          </section>
        </>}

        <section className="safety-panel">
          <div className="safety-icon">◎</div><div><p className="section-kicker">SAFE OUTREACH GATE</p><h2>Scout knows when to stop.</h2><p>Contact evidence comes only from persisted Greenhouse posting content and requires explicit acceptance. Drafts require approved immutable claims and revision-bound approval.</p></div>
          <div className="safety-steps"><span className="done">1 <b>Discover</b></span><i /><span className="done">2 <b>Extract</b></span><i /><span>3 <b>Draft</b></span><i /><span>4 <b>Approve</b></span></div>
        </section>
      </main>
      <footer><span>SCOUT / DISCOVERY + DRAFTING MVP</span><p>No send capability. No application capability. Human review required.</p><span>GREENHOUSE ONLY</span></footer>
    </div>
  );
}
