"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ecosystem.module.css";

type CapabilityMap = {
  curatedRegistryIsBootstrapNotAllowlist?: boolean;
  portfolioBoardsLeadOnly?: boolean;
  newContactsNeedReview?: boolean;
  guessEmails?: boolean;
  scrapePersonalContacts?: boolean;
  bypassCaptcha?: boolean;
  sendEmail?: boolean;
  submitApplication?: boolean;
};

type Source = {
  id: string;
  name: string;
  institutionType: string;
  officialUrl: string;
  directCareersUrl: string | null;
  portfolioBoardUrl: string | null;
  directRecruitingTarget: boolean;
};

type Lead = {
  sourceId: string | null;
  sourceName: string;
  institutionType: string;
  lane: string | null;
  sourceMode: "direct_institution" | "portfolio_board" | "ecosystem_index_lead";
  title: string;
  url: string;
  description: string;
  requiresOfficialSourceRegistration: boolean;
  requiresOfficialEmployerResolution: boolean;
  applicationPath: string;
  contactPath: string;
  focus?: string;
};

type MetadataPayload = { capabilities?: CapabilityMap; sources?: Source[]; adjacentLanes?: string[]; error?: string };
type DiscoverPayload = {
  enabled?: boolean;
  persistedSearchResults?: boolean;
  queryLanes?: string[];
  leads?: Lead[];
  reason?: string;
  error?: string;
};
type ActionPayload = {
  createdTargets?: number;
  researchedTargets?: number;
  candidatesStored?: number;
  rejectedWrongPurpose?: number;
  error?: string;
};
type PromotionPayload = {
  promotion?: { jobId: string; snapshotId: string; provider: string; company: string; title: string; created: boolean; refreshed: boolean; reused: boolean };
  evidence?: { officialAtsRefetched?: boolean; searchSnippetPersisted?: boolean };
  error?: string;
};

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function routeLabel(lead: Lead) {
  if (lead.requiresOfficialSourceRegistration) return "Review source before any job/contact trust";
  if (lead.requiresOfficialEmployerResolution) return "Resolve portfolio employer to official job/ATS";
  return "Official institution lead · preserve role evidence first";
}

function defaultCompanyHint(lead: Lead) {
  return lead.sourceMode === "direct_institution" ? lead.sourceName : "";
}

export function EcosystemWorkspace() {
  const [metadata, setMetadata] = useState<MetadataPayload>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [queryLanes, setQueryLanes] = useState<string[]>([]);
  const [companyHints, setCompanyHints] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/ecosystem");
    const payload = await response.json() as MetadataPayload;
    if (!response.ok) throw new Error(payload.error ?? "Unable to load ecosystem registry");
    setMetadata(payload);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load ecosystem workspace"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const leadCounts = useMemo(() => ({
    direct: leads.filter((lead) => lead.sourceMode === "direct_institution").length,
    portfolio: leads.filter((lead) => lead.sourceMode === "portfolio_board").length,
    review: leads.filter((lead) => lead.sourceMode === "ecosystem_index_lead" || lead.requiresOfficialSourceRegistration).length,
  }), [leads]);

  async function runAction(action: "discover" | "seed_recruiting_targets" | "research_public_contacts") {
    setBusy(action); setNotice(""); setError("");
    try {
      const response = await fetch("/api/ecosystem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as DiscoverPayload & ActionPayload;
      if (!response.ok) throw new Error(payload.error ?? "Ecosystem action failed");
      if (action === "discover") {
        const nextLeads = payload.leads ?? [];
        setLeads(nextLeads);
        setCompanyHints(Object.fromEntries(nextLeads.map((lead) => [lead.url, defaultCompanyHint(lead)])));
        setQueryLanes(payload.queryLanes ?? []);
        setNotice(payload.enabled === false
          ? payload.reason ?? "Search provider is disabled. Registry and existing Scout workspaces are still available."
          : `Found ${nextLeads.length} reviewable ecosystem lead(s). Search snippets remain ephemeral and are not trusted job evidence.`);
      } else if (action === "seed_recruiting_targets") {
        setNotice(`Added ${payload.createdTargets ?? 0} official institution recruiting target(s) to Company Outreach. No email was sent.`);
      } else {
        setNotice(`Researched ${payload.researchedTargets ?? 0} ecosystem target(s): ${payload.candidatesStored ?? 0} public business contact candidate(s) stored as needs_review; ${payload.rejectedWrongPurpose ?? 0} wrong-purpose inbox(es) rejected. Nothing was sent.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ecosystem action failed");
    } finally { setBusy(null); }
  }

  async function promoteLead(lead: Lead) {
    const companyHint = (companyHints[lead.url] ?? defaultCompanyHint(lead)).trim();
    if (!companyHint) {
      setError("Enter the actual employer company before Scout tries to resolve this portfolio/search lead.");
      return;
    }
    setBusy(`promote:${lead.url}`); setNotice(""); setError("");
    try {
      const response = await fetch("/api/lead-promotion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "resolve_promote",
          leadUrl: lead.url,
          companyHint,
          title: lead.title,
          sourceMode: lead.sourceMode,
        }),
      });
      const payload = await response.json() as PromotionPayload;
      if (!response.ok || !payload.promotion) throw new Error(payload.error ?? "No independently verified official ATS posting was found");
      const state = payload.promotion.reused ? "reused" : payload.promotion.refreshed ? "refreshed" : "saved";
      setNotice(`${payload.promotion.company} — ${payload.promotion.title}: official ${payload.promotion.provider} evidence ${state} as an immutable Scout job. The search lead itself was not persisted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Official role resolution failed");
    } finally { setBusy(null); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / OPPORTUNITY COMMAND CENTER</p>
        <h1>Capital, startup and ecosystem opportunities — routed with evidence, not scraped into spam.</h1>
        <p className={styles.intro}>Search venture funds, portfolio boards, accelerators, studios, impact investors, CVC, Founder&apos;s Office and adjacent early-career lanes. Portfolio boards are leads only; unregistered sources stay review-only; public contacts stay <strong>needs_review</strong>.</p>
      </div>
      <nav className={styles.nav}><Link href="/command-center">Command Center</Link><Link href="/company-outreach">Company Outreach</Link><Link href="/applications">Applications</Link><Link href="/">Dashboard</Link></nav>
    </header>

    <section className={styles.guardrail}>
      <strong>Human-controlled boundary</strong>
      <span>Scout may research published recruiting/business contacts and prepare personalized drafts. After you approve the exact revision it may create a Gmail draft, but it does not guess emails, scrape personal contacts, bypass CAPTCHA/login, send outreach, or submit applications.</span>
    </section>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.metrics} aria-label="Ecosystem workspace summary">
      <article><span>Bootstrap sources</span><strong>{metadata.sources?.length ?? 0}</strong><small>Registry is a starting point, not a closed allowlist.</small></article>
      <article><span>Search lanes</span><strong>{queryLanes.length || metadata.adjacentLanes?.length || 0}</strong><small>Capital + startup + ecosystem surfaces.</small></article>
      <article><span>Direct leads</span><strong>{leadCounts.direct}</strong><small>Official institution roles to verify and rank.</small></article>
      <article><span>Portfolio / review</span><strong>{leadCounts.portfolio + leadCounts.review}</strong><small>Must resolve before application/contact trust.</small></article>
    </section>

    <section className={styles.actionsPanel}>
      <div><p className={styles.kicker}>RUN</p><h2>Research deeply. Draft carefully. Promote only official evidence.</h2></div>
      <div className={styles.actions}>
        <button disabled={busy !== null} onClick={() => void runAction("discover")}>{busy === "discover" ? "Searching…" : "Discover ecosystem leads"}</button>
        <button className={styles.secondary} disabled={busy !== null} onClick={() => void runAction("seed_recruiting_targets")}>{busy === "seed_recruiting_targets" ? "Seeding…" : "Seed official recruiting targets"}</button>
        <button className={styles.secondary} disabled={busy !== null} onClick={() => void runAction("research_public_contacts")}>{busy === "research_public_contacts" ? "Researching…" : "Research public recruiting contacts"}</button>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>DISCOVERED LEADS</p><h2>{leads.length ? `${leads.length} leads to triage` : "Run discovery to build the review queue"}</h2></div><p>Nothing here becomes trusted job evidence just because a search engine returned it.</p></div>
      {!leads.length && <div className={styles.empty}>Search results are intentionally ephemeral. When you run discovery, Scout will show direct institution leads, portfolio-board leads, and unregistered ecosystem leads with different next-step rules.</div>}
      <div className={styles.leadList}>
        {leads.map((lead) => <article className={styles.leadCard} key={`${lead.sourceMode}:${lead.url}`}>
          <div className={styles.leadTop}>
            <div><div className={styles.tags}><span>{humanize(lead.sourceMode)}</span>{lead.lane && <span>{humanize(lead.lane)}</span>}<span>{humanize(lead.institutionType)}</span></div><h3>{lead.title}</h3><p className={styles.source}>{lead.sourceName}</p></div>
            <a href={lead.url} target="_blank" rel="noreferrer">Open source ↗</a>
          </div>
          {lead.description && <p>{lead.description}</p>}
          <div className={styles.routeBox}><strong>{routeLabel(lead)}</strong><span>{lead.requiresOfficialEmployerResolution ? "Use the investor board only as context; Scout can now independently resolve the startup's supported official ATS before saving anything." : "Scout will independently search/re-fetch a supported official ATS and persist only that verified role evidence."}</span></div>
          <label>Employer company<input value={companyHints[lead.url] ?? defaultCompanyHint(lead)} onChange={(event) => setCompanyHints((current) => ({ ...current, [lead.url]: event.target.value }))} placeholder={lead.sourceMode === "direct_institution" ? lead.sourceName : "Actual startup / employer name"} /></label>
          <div className={styles.cardActions}>
            <button disabled={busy !== null} onClick={() => void promoteLead(lead)}>{busy === `promote:${lead.url}` ? "Resolving official ATS…" : "Resolve & save official role"}</button>
            <Link href="/sources">Review sources →</Link>
            {lead.sourceMode === "direct_institution" && <Link href="/company-outreach">Review public contact path →</Link>}
          </div>
        </article>)}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>BOOTSTRAP REGISTRY</p><h2>Known official ecosystem surfaces</h2></div><p>These sources get stronger routing. New legitimate institutions can still surface as review-only leads.</p></div>
      <div className={styles.sourceGrid}>{(metadata.sources ?? []).map((source) => <article className={styles.sourceCard} key={source.id}><div><span>{humanize(source.institutionType)}</span><h3>{source.name}</h3></div><div className={styles.sourceLinks}><a href={source.officialUrl} target="_blank" rel="noreferrer">Official site</a>{source.directCareersUrl && <a href={source.directCareersUrl} target="_blank" rel="noreferrer">Careers</a>}{source.portfolioBoardUrl && <a href={source.portfolioBoardUrl} target="_blank" rel="noreferrer">Portfolio board</a>}</div></article>)}</div>
    </section>

    <section className={styles.footerGrid}>
      <Link href="/sources"><strong>Sources</strong><span>Review newly discovered institutions; independently verified ATS sources can be registered by promotion.</span></Link>
      <Link href="/quality"><strong>Quality</strong><span>Rank promoted official roles by evidence, fit, timing and eligibility.</span></Link>
      <Link href="/company-outreach"><strong>Company Outreach</strong><span>Accept/reject published recruiting evidence, generate personalized claim-backed outreach, approve the exact revision, then create a Gmail draft.</span></Link>
      <Link href="/assist"><strong>Safe Fill</strong><span>Prepare visible application fields; you still make the final submit decision.</span></Link>
    </section>
  </main>;
}
