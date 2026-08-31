"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { classifyApplicationUrl } from "../../lib/scout/application-sites";
import {
  assessOpportunityTrack,
  matchesOpportunityRegion,
  OPPORTUNITY_TRACK_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  SUMMER_2027_WINDOW,
  type OpportunityTrack,
} from "../../lib/scout/opportunity-tracks";
import styles from "./inbox.module.css";

type LeadJob = {
  id: string;
  source: string;
  company: string;
  title: string;
  canonicalUrl: string;
  currentSnapshotId: string | null;
  lastSeenAt: string;
};

type DiscoveryLead = {
  canonicalUrl: string;
  company: string;
  title: string;
  provider: string;
  sourceUrl: string;
  focus: string;
  location: string;
  postedAt: string | null;
  description?: string;
  workplaceType?: string;
};

type DiscoveryFailure = {
  company: string;
  provider?: string;
  reason?: string;
};

type RunScoutResponse = {
  run?: {
    discovery?: { found?: number; created?: number; existing?: number; failures?: DiscoveryFailure[]; leads?: DiscoveryLead[] };
    resolution?: { attempted?: number; resolved?: number; deferred?: number; failures?: unknown[] };
    applications?: { prepared?: number; readyForReview?: number; needsInput?: number };
    companyDomains?: { attempted?: number; enriched?: number; pending?: number; failures?: unknown[] };
    contacts?: { jobsResearched?: number; candidatesSaved?: number; classified?: number; failures?: unknown[] };
    reviewQueue?: { applicationsReady?: number; applicationsNeedInput?: number; contactsNeedReview?: number };
  };
  error?: string;
};

type DiscoveryRegion = "All" | "India" | "Remote" | "Global";

const discoveryRegions: DiscoveryRegion[] = ["All", "India", "Remote", "Global"];
const discoveryTracks: OpportunityTrack[] = ["now_remote", "summer_2027", "other_internship", "fellowships", "research", "jobs"];

function isLoopbackBrowser() {
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function sourceFailureDetails(failures: DiscoveryFailure[], limit = 6) {
  const details = failures.slice(0, limit).map((failure) => {
    const provider = failure.provider ? `/${failure.provider}` : "";
    return `${failure.company}${provider}: ${failure.reason ?? "temporarily unavailable"}`;
  }).join("; ");
  const remaining = Math.max(0, failures.length - limit);
  return details ? `${details}${remaining ? `; +${remaining} more` : ""}` : "";
}

function geographyLabel(lead: DiscoveryLead) {
  const assessment = assessOpportunityTrack(lead);
  if (assessment.isRemote && assessment.isIndia) return "REMOTE · INDIA";
  if (assessment.isRemote) return "REMOTE";
  if (assessment.isIndia) return "INDIA";
  return "GLOBAL";
}

function fitSummary(lead: DiscoveryLead) {
  const assessment = assessOpportunityTrack(lead);
  const details: string[] = [];
  if (assessment.track === "now_remote") {
    if (assessment.collegeCompatibility === "promising") details.push("College schedule: promising signal");
    else if (assessment.collegeCompatibility === "likely_conflict") details.push("College schedule: likely conflict");
    else details.push("College schedule: confirm hours/days");
  }
  if (assessment.track === "summer_2027" || assessment.opportunityType === "internship") {
    if (assessment.summerWindowFit === "strong") details.push(`Summer window: strong ${SUMMER_2027_WINDOW.label} match`);
    else if (assessment.summerWindowFit === "compatible") details.push("Summer 2027: compatible, confirm exact dates");
    else if (assessment.summerWindowFit === "mismatch") details.push("Summer 2027: duration/date mismatch");
  }
  if (assessment.cultureSignal === "watchlist") details.push("Culture/internet watchlist");
  else if (assessment.cultureSignal === "culture_adjacent") details.push("Culture/internet-adjacent");
  if (assessment.eligibilityFlags.length) details.push("Eligibility: manual check required");
  return details.join(" · ");
}

export function InternshipInbox() {
  const [form, setForm] = useState({ url: "", company: "", title: "" });
  const [leads, setLeads] = useState<LeadJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveryLead[]>([]);
  const [trackFilter, setTrackFilter] = useState<OpportunityTrack>("now_remote");
  const [regionFilter, setRegionFilter] = useState<DiscoveryRegion>("All");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadLeads = useCallback(async () => {
    const response = await fetch("/api/jobs");
    const payload = await response.json() as { jobs?: LeadJob[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load internship leads");
    setLeads((payload.jobs ?? []).filter((job) => job.source.startsWith("lead:")));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLeads().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load internship leads"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeads]);

  const channel = form.url.trim() ? classifyApplicationUrl(form.url.trim()) : null;
  const classifiedDiscovered = useMemo(() => discovered.map((lead) => ({ lead, assessment: assessOpportunityTrack(lead) })), [discovered]);
  const trackCounts = useMemo(() => {
    const counts = Object.fromEntries(discoveryTracks.map((track) => [track, 0])) as Record<OpportunityTrack, number>;
    for (const entry of classifiedDiscovered) counts[entry.assessment.track] += 1;
    return counts;
  }, [classifiedDiscovered]);
  const trackDiscovered = useMemo(() => classifiedDiscovered.filter((entry) => entry.assessment.track === trackFilter).map((entry) => entry.lead), [classifiedDiscovered, trackFilter]);
  const regionCounts = useMemo(() => {
    const counts: Record<DiscoveryRegion, number> = { All: trackDiscovered.length, India: 0, Remote: 0, Global: 0 };
    for (const lead of trackDiscovered) {
      if (matchesOpportunityRegion(lead, "India")) counts.India += 1;
      if (matchesOpportunityRegion(lead, "Remote")) counts.Remote += 1;
      if (matchesOpportunityRegion(lead, "Global")) counts.Global += 1;
    }
    return counts;
  }, [trackDiscovered]);
  const visibleDiscovered = useMemo(() => trackDiscovered.filter((lead) => matchesOpportunityRegion(lead, regionFilter)), [trackDiscovered, regionFilter]);

  function chooseTrack(track: OpportunityTrack) {
    setTrackFilter(track);
    setRegionFilter("All");
  }

  async function runLocalDevelopmentFallback() {
    const bridgeResponse = await fetch("http://127.0.0.1:43119/discover", { method: "GET", cache: "no-store" });
    if (!bridgeResponse.ok) throw new Error("Local discovery bridge unavailable");
    const envelope = await bridgeResponse.json() as { payload?: string; signature?: string; error?: string };
    if (!envelope.payload || !envelope.signature) throw new Error(envelope.error ?? "Local discovery bridge returned an invalid envelope");
    const importResponse = await fetch("/api/lead-discovery/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: envelope.payload, signature: envelope.signature }),
    });
    const imported = await importResponse.json() as {
      found?: number;
      created?: number;
      upgraded?: number;
      existing?: number;
      leads?: DiscoveryLead[];
      failures?: DiscoveryFailure[];
      error?: string;
    };
    if (!importResponse.ok) throw new Error(imported.error ?? "Unable to import local discovery results");
    const resolutionResponse = await fetch("/api/lead-resolution", { method: "POST" });
    const resolution = await resolutionResponse.json() as { resolved?: number; pending?: number; error?: string };
    if (!resolutionResponse.ok) throw new Error(resolution.error ?? "Unable to resolve official postings");
    setDiscovered(imported.leads ?? []);
    setTrackFilter("now_remote");
    setRegionFilter("All");
    await loadLeads();
    const failures = imported.failures ?? [];
    const details = sourceFailureDetails(failures);
    setNotice(
      `Development fallback found ${imported.found ?? 0} opportunity lead(s), saved ${imported.created ?? 0} new lead(s), upgraded ${imported.upgraded ?? 0} existing lead(s) to immutable official snapshots, and resolved ${resolution.resolved ?? 0} additional supported lead(s).${failures.length ? ` ${failures.length} source failure(s) were isolated.` : ""}${details ? ` Source details: ${details}.` : ""} Discovery and track classification are deterministic; cloud-agent application/contact stages were not run in this fallback.`,
    );
  }

  async function runScoutNow() {
    setError("");
    setNotice("");
    setDiscovering(true);
    try {
      const response = await fetch("/api/agent/run", { method: "POST" });
      const payload = await response.json() as RunScoutResponse;
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "Cloud Scout run failed");
      const run = payload.run;
      setDiscovered(run.discovery?.leads ?? []);
      setTrackFilter("now_remote");
      setRegionFilter("All");
      await loadLeads();
      const discoveryFailures = run.discovery?.failures ?? [];
      const sourceFailures = discoveryFailures.length;
      const pipelineFailures = (run.resolution?.failures?.length ?? 0)
        + (run.companyDomains?.failures?.length ?? 0)
        + (run.contacts?.failures?.length ?? 0);
      const sourceDetails = sourceFailureDetails(discoveryFailures, 4);
      setNotice(
        `Scout found ${run.discovery?.found ?? 0} opportunity lead(s) across controlled and search lanes, saved ${run.discovery?.created ?? 0} new lead(s), resolved ${run.resolution?.resolved ?? 0} official posting(s), verified/enriched ${run.companyDomains?.enriched ?? 0} company domain(s), prepared ${run.applications?.prepared ?? 0} application packet(s), found ${run.contacts?.candidatesSaved ?? 0} published contact candidate(s), and AI-classified ${run.contacts?.classified ?? 0}. Review queue: ${run.reviewQueue?.applicationsReady ?? 0} application(s) ready, ${run.reviewQueue?.applicationsNeedInput ?? 0} needing input, ${run.reviewQueue?.contactsNeedReview ?? 0} contact(s) needing review.${sourceFailures + pipelineFailures ? ` ${sourceFailures + pipelineFailures} bounded stage/source failure(s) were recorded.` : ""}${sourceDetails ? ` Discovery source details: ${sourceDetails}.` : ""}`,
      );
    } catch (caught) {
      if (!isLoopbackBrowser()) {
        setError(caught instanceof Error ? caught.message : "Unable to run Scout");
        return;
      }
      try {
        await runLocalDevelopmentFallback();
      } catch (fallbackError) {
        const cloudMessage = caught instanceof Error ? caught.message : "Cloud Scout run failed";
        const localMessage = fallbackError instanceof Error ? fallbackError.message : "Local fallback failed";
        setError(`${cloudMessage}. Local development fallback also failed: ${localMessage}`);
      }
    } finally {
      setDiscovering(false);
    }
  }

  async function saveLead() {
    setError("");
    setNotice("");
    if (!form.url.trim() || !form.company.trim() || !form.title.trim()) {
      setError("Internship URL, company and role title are required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json() as { created?: boolean; lead?: { channel?: { label?: string }; nextStep?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to save internship lead");
      setForm({ url: "", company: "", title: "" });
      setNotice(`${payload.created ? "Saved" : "Already saved"}. Scout will resolve it through the cloud pipeline when the platform has a supported official resolver.`);
      await loadLeads();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save internship lead");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / OPPORTUNITY INBOX</p><h1>Internships first, without mixing every kind of job together.</h1><p>Scout now separates alongside-college remote internships, the {SUMMER_2027_WINDOW.label} corporate-internship window, other internships, fellowships, research/live-project opportunities and permanent jobs. Missing schedule/date evidence stays explicit instead of being guessed.</p></div>
      <div><Link href="/review" className={styles.back}>Review Queue</Link><Link href="/" className={styles.back}>← Dashboard</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.discovery}>
      <div><p className={styles.kicker}>DISCOVERY PIPELINE</p><h2>Run Scout now</h2><p>Public ATS discovery, source verification and the new track/type classification are deterministic and do not require an AI API. When an AI route is available, Scout can use it for bounded contact triage or reviewed drafting. No application is submitted and no email is sent.</p></div>
      <button disabled={discovering} onClick={() => void runScoutNow()}>{discovering ? "Scout is working…" : "Run Scout now"}</button>
    </section>

    {discovered.length > 0 && <section className={styles.results}>
      <div className={styles.listHead}><div><p className={styles.kicker}>LATEST DISCOVERY</p><h2>{visibleDiscovered.length} of {trackDiscovered.length} in {OPPORTUNITY_TRACK_LABELS[trackFilter]}</h2></div><p>These are discovery leads, not final fit decisions. Exact approved claim IDs and qualification checks appear only after official resolution. <Link href="/shortlist">Review resolved evidence →</Link></p></div>
      <div className={styles.regionFilters} aria-label="Opportunity track filters">
        {discoveryTracks.map((track) => <button key={track} className={trackFilter === track ? styles.regionActive : ""} onClick={() => chooseTrack(track)}>{OPPORTUNITY_TRACK_LABELS[track]} <span>{trackCounts[track]}</span></button>)}
      </div>
      <div className={styles.regionFilters} aria-label="Discovery region filters">
        {discoveryRegions.map((region) => <button key={region} className={regionFilter === region ? styles.regionActive : ""} onClick={() => setRegionFilter(region)}>{region} <span>{regionCounts[region]}</span></button>)}
      </div>
      {visibleDiscovered.slice(0, 24).map((lead) => {
        const assessment = assessOpportunityTrack(lead);
        const summary = fitSummary(lead);
        return <article className={styles.card} key={lead.canonicalUrl}>
          <div><p className={styles.source}>{OPPORTUNITY_TYPE_LABELS[assessment.opportunityType].toUpperCase()} · {geographyLabel(lead)} · {lead.provider.toUpperCase()} · {lead.location || "Location unspecified"}</p><h3>{lead.company} — {lead.title}</h3><p>{lead.focus}</p>{summary && <p>{summary}</p>}<p>{assessment.track === "now_remote" ? assessment.collegeCompatibilityReason : assessment.track === "summer_2027" ? assessment.summerWindowReason : assessment.cultureReason ?? "Track classification is based only on available posting/discovery evidence."}</p></div>
          <a href={lead.canonicalUrl} target="_blank" rel="noreferrer">Open discovered lead ↗</a>
        </article>;
      })}
      {!visibleDiscovered.length && <div className={styles.empty}>No opportunities in this lane from the latest run. Scout will not manufacture a match just to fill the section.</div>}
    </section>}

    <section className={styles.composer}>
      <label>Internship URL<input type="url" value={form.url} onChange={(event) => setForm((value) => ({ ...value, url: event.target.value }))} placeholder="LinkedIn, Tally, Workday, Internshala, company careers…" /></label>
      <label>Company<input value={form.company} maxLength={160} onChange={(event) => setForm((value) => ({ ...value, company: event.target.value }))} placeholder="Company name" /></label>
      <label>Role title<input value={form.title} maxLength={240} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} placeholder="Product Intern" /></label>
      <div className={styles.channel}>{channel ? <><strong>{channel.label}</strong><span>{channel.note}</span></> : <span>Paste a link to classify the application channel.</span>}</div>
      <button disabled={busy} onClick={() => void saveLead()}>{busy ? "Saving…" : "Save internship"}</button>
    </section>

    <section className={styles.list}>
      <div className={styles.listHead}><div><p className={styles.kicker}>UNRESOLVED INTERNSHIP LEADS</p><h2>{leads.length} waiting for official resolution</h2></div><p>LinkedIn, Internshala, Tally/forms and unsupported portals stay here until Scout can bind them to trustworthy job evidence. Scout does not claim resume support or qualification fit before that evidence exists.</p></div>
      {!leads.length && <div className={styles.empty}>No unresolved internship leads right now.</div>}
      {leads.map((lead) => <article className={styles.card} key={lead.id}>
        <div><p className={styles.source}>{lead.source.replace("lead:", "").toUpperCase()}</p><h3>{lead.company} — {lead.title}</h3><p>{lead.currentSnapshotId ? "Official snapshot captured" : "Needs official posting resolution before application prep"}</p></div>
        <a href={lead.canonicalUrl} target="_blank" rel="noreferrer">Open lead ↗</a>
      </article>)}
    </section>
  </main>;
}
