"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./company-outreach.module.css";

type Target = {
  id: string;
  companyName: string;
  companyDomain: string;
  officialUrl: string;
  track: "now_remote" | "summer_2027";
  interestNote: string | null;
  state: "active" | "archived";
};

type Contact = {
  id: string;
  targetId: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: string;
  suitability: string;
  suitabilityReason: string;
  reviewState: "needs_review" | "accepted" | "rejected";
};

type Revision = {
  id: string;
  version: number;
  body: string;
  claimIds: string[];
  contactId: string;
};

type Draft = {
  id: string;
  targetId: string;
  state: "draft" | "approved" | "rejected";
  approvedRevisionId?: string | null;
  revisions: Revision[];
};

type Claim = { id: string; statement: string; status: "draft" | "approved" | "rejected" };

type AutopilotPayload = {
  createdTargets?: number;
  queuedTargets?: number;
  researchedTargets?: number;
  candidatesFound?: number;
  deferredTargets?: number;
  searchProvider?: string | null;
  error?: string;
};

type EcosystemLead = {
  sourceName: string;
  institutionType: string;
  sourceMode: "direct_institution" | "portfolio_board" | "ecosystem_index_lead";
  title: string;
  url: string;
  description: string;
  requiresOfficialSourceRegistration: boolean;
};

type EcosystemPayload = {
  enabled?: boolean;
  leads?: EcosystemLead[];
  reason?: string;
  error?: string;
};

const emptyTarget = { companyName: "", companyDomain: "", officialUrl: "", track: "now_remote" as const, interestNote: "" };

export function CompanyOutreachWorkspace() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [targetForm, setTargetForm] = useState(emptyTarget);
  const [targetId, setTargetId] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [ecosystemLeads, setEcosystemLeads] = useState<EcosystemLead[]>([]);
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [targetsResponse, contactsResponse, draftsResponse, claimsResponse] = await Promise.all([
      fetch("/api/company-outreach"),
      fetch("/api/company-outreach/contacts"),
      fetch("/api/company-outreach/drafts"),
      fetch("/api/claims"),
    ]);
    const targetsPayload = await targetsResponse.json() as { targets?: Target[]; error?: string };
    const contactsPayload = await contactsResponse.json() as { contacts?: Contact[]; error?: string };
    const draftsPayload = await draftsResponse.json() as { drafts?: Draft[]; error?: string };
    const claimsPayload = await claimsResponse.json() as { claims?: Claim[]; error?: string };
    if (!targetsResponse.ok) throw new Error(targetsPayload.error ?? "Unable to load company targets");
    if (!contactsResponse.ok) throw new Error(contactsPayload.error ?? "Unable to load company contacts");
    if (!draftsResponse.ok) throw new Error(draftsPayload.error ?? "Unable to load company drafts");
    if (!claimsResponse.ok) throw new Error(claimsPayload.error ?? "Unable to load approved claims");
    setTargets(targetsPayload.targets ?? []);
    setContacts(contactsPayload.contacts ?? []);
    setDrafts(draftsPayload.drafts ?? []);
    setClaims((claimsPayload.claims ?? []).filter((claim) => claim.status === "approved"));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load company outreach")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedTarget = targets.find((target) => target.id === targetId) ?? null;
  const filteredTargets = useMemo(() => {
    const query = companyFilter.trim().toLowerCase();
    return targets
      .filter((target) => target.state === "active")
      .filter((target) => !query || target.companyName.toLowerCase().includes(query) || target.companyDomain.toLowerCase().includes(query))
      .sort((left, right) => left.companyName.localeCompare(right.companyName));
  }, [companyFilter, targets]);
  const selectedContacts = useMemo(() => contacts.filter((contact) => contact.targetId === targetId && contact.reviewState !== "rejected"), [contacts, targetId]);
  const selectedDrafts = useMemo(() => drafts.filter((draft) => draft.targetId === targetId), [drafts, targetId]);

  function toggleClaim(id: string) {
    setSelectedClaimIds((current) => current.includes(id)
      ? current.filter((claimId) => claimId !== id)
      : current.length < 3 ? [...current, id] : current);
  }

  async function createTarget() {
    setBusy("create-target"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...targetForm, interestNote: targetForm.interestNote.trim() || null }),
      });
      const payload = await response.json() as { target?: Target; created?: boolean; error?: string };
      if (!response.ok || !payload.target) throw new Error(payload.error ?? "Unable to create company target");
      setTargetForm(emptyTarget);
      setTargetId(payload.target.id);
      setNotice(payload.created ? "Company-first outreach target created. No job opening was invented." : "That company/track target already exists; using the existing evidence target.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create company target");
    } finally { setBusy(null); }
  }

  async function findMoreCompanies() {
    setBusy("find-companies"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach/autopilot", { method: "POST" });
      const payload = await response.json() as AutopilotPayload;
      if (!response.ok) throw new Error(payload.error ?? "Unable to expand the company outreach queue");
      await load();
      setNotice(`Expanded Scout's controlled company queue: ${payload.createdTargets ?? 0} new target(s), ${payload.queuedTargets ?? 0} active target(s), ${payload.researchedTargets ?? 0} bounded contact-research pass(es), ${payload.candidatesFound ?? 0} published contact candidate(s). Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to expand the company outreach queue");
    } finally { setBusy(null); }
  }

  async function discoverBroaderCompanies() {
    setBusy("discover-companies"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ecosystem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discover" }),
      });
      const payload = await response.json() as EcosystemPayload;
      if (!response.ok) throw new Error(payload.error ?? "Unable to discover broader company leads");
      const leads = payload.leads ?? [];
      setEcosystemLeads(leads);
      setNotice(payload.enabled === false
        ? payload.reason ?? "Broader web discovery is disabled; controlled Scout company sources are still available."
        : `Found ${leads.length} broader ecosystem/company lead(s). They stay review-only until you explicitly add an official company target.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to discover broader company leads");
    } finally { setBusy(null); }
  }

  function reviewLeadAsTarget(lead: EcosystemLead) {
    if (lead.sourceMode === "portfolio_board") {
      setError("Portfolio-board results are lead-only. Resolve the actual employer in Ecosystem before using it for contact research.");
      return;
    }
    try {
      const url = new URL(lead.url);
      const companyDomain = url.hostname.toLowerCase().replace(/^www\./, "");
      setTargetForm({
        companyName: lead.sourceName,
        companyDomain,
        officialUrl: lead.url,
        track: targetForm.track,
        interestNote: "",
      });
      setNotice("Company lead copied into the reviewed target form. Check the company name, official domain and URL, then create the target before Scout researches contacts.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("That ecosystem lead does not contain a valid official HTTPS company URL.");
    }
  }

  async function research() {
    if (!targetId) return;
    setBusy("research"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      const payload = await response.json() as { pagesAttempted?: number; candidatesFound?: number; failures?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to research recruiting contacts");
      await load();
      setNotice(`Checked ${payload.pagesAttempted ?? 0} bounded first-party page(s) and found ${payload.candidatesFound ?? 0} published business contact candidate(s). Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to research recruiting contacts");
    } finally { setBusy(null); }
  }

  async function reviewContact(contact: Contact, reviewState: "accepted" | "rejected") {
    setBusy(`contact-${contact.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach/contacts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: contact.id, reviewState }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to review contact");
      await load();
      setNotice(reviewState === "accepted" ? "Published recruiting/business contact accepted. Nothing was sent." : "Contact rejected. Nothing was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to review contact");
    } finally { setBusy(null); }
  }

  async function createDraft(contact: Contact) {
    if (selectedClaimIds.length < 1) { setError("Choose 1-3 approved claims that actually fit this company outreach."); return; }
    setBusy(`draft-${contact.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, claimIds: selectedClaimIds }),
      });
      const payload = await response.json() as { draft?: { deterministicFallback?: boolean; model?: string }; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "Unable to draft company-first outreach");
      await load();
      setNotice(payload.draft.deterministicFallback
        ? "Speculative outreach draft created from your approved claims. Cloud AI was unavailable or unsuitable, so Scout used the safe deterministic draft."
        : `Cloud-AI speculative outreach draft created${payload.draft.model ? ` (${payload.draft.model})` : ""}. Review the exact text below.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to draft company-first outreach");
    } finally { setBusy(null); }
  }

  async function reviewDraft(draft: Draft, action: "approve" | "reject") {
    const revision = draft.revisions.at(-1);
    if (!revision) return;
    setBusy(`${action}-${draft.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach/drafts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: draft.id, action, revisionId: revision.id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Unable to ${action} draft`);
      await load();
      setNotice(action === "approve" ? "Exact speculative outreach revision approved. It can now become a Gmail draft; nothing was sent." : "Draft rejected. Nothing was sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to ${action} draft`);
    } finally { setBusy(null); }
  }

  async function createGmailDraft(draft: Draft) {
    setBusy(`gmail-${draft.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/company-outreach/gmail-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      const payload = await response.json() as { gmailDraft?: { draftId?: string; reused?: boolean }; error?: string };
      if (!response.ok || !payload.gmailDraft) throw new Error(payload.error ?? "Unable to create Gmail draft");
      setNotice(payload.gmailDraft.reused ? `Existing Gmail draft reused (${payload.gmailDraft.draftId}). Nothing was sent.` : `Gmail draft created (${payload.gmailDraft.draftId}). Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Gmail draft");
    } finally { setBusy(null); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / COMPANY-FIRST OUTREACH</p>
        <h1>No internship posting? Find the legitimate recruiting channel anyway.</h1>
        <p>Create a company target without inventing a job opening. Scout checks bounded first-party pages for published recruiting/business emails, preserves provenance, drafts a clearly speculative note from approved claims, and can create a Gmail draft only after your approval.</p>
      </div>
      <nav className={styles.links}><Link href="/contacts">Role contacts</Link><Link href="/inbox">Internships</Link><Link href="/">Dashboard</Link></nav>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>NEW TARGET</p><h2>Register the official company domain</h2></div><p>This explicit owner action controls the external pages Scout may inspect.</p></div>
      <div className={styles.grid}>
        <label>Company<input value={targetForm.companyName} onChange={(event) => setTargetForm((value) => ({ ...value, companyName: event.target.value }))} placeholder="Company name" /></label>
        <label>Official domain<input value={targetForm.companyDomain} onChange={(event) => setTargetForm((value) => ({ ...value, companyDomain: event.target.value }))} placeholder="company.com" /></label>
        <label>Official website / careers URL<input value={targetForm.officialUrl} onChange={(event) => setTargetForm((value) => ({ ...value, officialUrl: event.target.value }))} placeholder="https://company.com/" /></label>
        <label>Outreach track<select value={targetForm.track} onChange={(event) => setTargetForm((value) => ({ ...value, track: event.target.value as "now_remote" | "summer_2027" }))}><option value="now_remote">Now · Remote / live project</option><option value="summer_2027">Summer 2027 · 21 May–31 Jul</option></select></label>
      </div>
      <label>Your one-line reason for liking this company (optional)<input value={targetForm.interestNote} onChange={(event) => setTargetForm((value) => ({ ...value, interestNote: event.target.value }))} placeholder="A sentence Scout may preserve in the draft." /></label>
      <button disabled={busy !== null} onClick={() => void createTarget()}>{busy === "create-target" ? "Creating…" : "Create company target"}</button>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>DISCOVERY</p><h2>Find more companies — the starter list is not the universe.</h2></div><p>Expand from every controlled Scout company source, then optionally surface broader ecosystem leads for explicit review before contact research.</p></div>
      <div className={styles.actions}>
        <button disabled={busy !== null} onClick={() => void findMoreCompanies()}>{busy === "find-companies" ? "Expanding company queue…" : "Find more companies"}</button>
        <button className={styles.secondary} disabled={busy !== null} onClick={() => void discoverBroaderCompanies()}>{busy === "discover-companies" ? "Searching broader ecosystem…" : "Broader ecosystem search"}</button>
      </div>
      <p><strong>{targets.filter((target) => target.state === "active").length}</strong> active outreach target(s). Controlled-source expansion is open-ended over registered Scout employers; contact crawling remains bounded and every new email still defaults to <strong>needs_review</strong>.</p>
      {ecosystemLeads.length > 0 && <div className={styles.list}>{ecosystemLeads.map((lead) => <article className={styles.card} key={`${lead.sourceMode}:${lead.url}`}>
        <div><div className={styles.meta}>{lead.sourceMode.replaceAll("_", " ")} · {lead.institutionType.replaceAll("_", " ")}</div><h3>{lead.sourceName}</h3><p>{lead.title}</p>{lead.description && <small>{lead.description}</small>}</div>
        <div className={styles.actions}><a href={lead.url} target="_blank" rel="noreferrer">Open source ↗</a>{lead.sourceMode !== "portfolio_board" ? <button className={styles.secondary} disabled={busy !== null} onClick={() => reviewLeadAsTarget(lead)}>Review as outreach target</button> : <Link href="/ecosystem">Resolve employer first →</Link>}</div>
      </article>)}</div>}
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>TARGETS</p><h2>Relentless about public evidence</h2></div><p>No LinkedIn email scraping, no guessed address patterns, no data brokers.</p></div>
      <label>Filter companies<input value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} placeholder="Search company or domain" /></label>
      <label>Company target<select value={targetId} onChange={(event) => { setTargetId(event.target.value); setSelectedClaimIds([]); }}><option value="">Choose a company…</option>{filteredTargets.map((target) => <option key={target.id} value={target.id}>{target.companyName} — {target.track === "now_remote" ? "Now · Remote" : "Summer 2027"}</option>)}</select></label>
      {selectedTarget && <div className={styles.targetCard}><div><strong>{selectedTarget.companyName}</strong><span>{selectedTarget.companyDomain}</span></div><a href={selectedTarget.officialUrl} target="_blank" rel="noreferrer">Official site ↗</a></div>}
      <button disabled={busy !== null || !targetId} onClick={() => void research()}>{busy === "research" ? "Checking official pages…" : "Find published HR / recruiting contacts"}</button>
    </section>

    {selectedTarget && <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>APPROVED CLAIMS</p><h2>Choose what this speculative email may say</h2></div><p>Pick 1–3. Scout does not infer relevance without a real JD.</p></div>
      <div className={styles.claims}>{claims.map((claim) => <label className={styles.claim} key={claim.id}><input type="checkbox" checked={selectedClaimIds.includes(claim.id)} onChange={() => toggleClaim(claim.id)} disabled={!selectedClaimIds.includes(claim.id) && selectedClaimIds.length >= 3} /><span>{claim.statement}</span></label>)}</div>
    </section>}

    {selectedTarget && <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>PUBLISHED CONTACT EVIDENCE</p><h2>{selectedContacts.length} captured candidate(s)</h2></div><p>Every candidate remains review-bound even if it looks like HR/talent.</p></div>
      {!selectedContacts.length && <div className={styles.empty}>No published same-domain recruiting/business email captured yet. Zero is allowed; Scout will not invent one.</div>}
      <div className={styles.list}>{selectedContacts.map((contact) => <article className={styles.card} key={contact.id}>
        <div><div className={styles.meta}>{contact.reviewState} · {contact.sourceType}</div><h3>{contact.email}</h3><p>{contact.excerpt}</p><small>{contact.suitabilityReason}</small></div>
        <div className={styles.actions}>{contact.reviewState === "needs_review" && <><button disabled={busy !== null} onClick={() => void reviewContact(contact, "accepted")}>Accept evidence</button><button className={styles.secondary} disabled={busy !== null} onClick={() => void reviewContact(contact, "rejected")}>Reject</button></>}{contact.reviewState === "accepted" && <button disabled={busy !== null || selectedClaimIds.length < 1} onClick={() => void createDraft(contact)}>{busy === `draft-${contact.id}` ? "Drafting…" : "Draft speculative outreach"}</button>}<a href={contact.sourceUrl} target="_blank" rel="noreferrer">Exact source ↗</a></div>
      </article>)}</div>
    </section>}

    {selectedTarget && <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>DRAFTS</p><h2>Review every exact revision before Gmail</h2></div><p>Final Send remains yours.</p></div>
      {!selectedDrafts.length && <div className={styles.empty}>No company-first outreach draft yet.</div>}
      <div className={styles.list}>{selectedDrafts.map((draft) => { const revision = draft.revisions.at(-1); return <article className={styles.card} key={draft.id}><div><div className={styles.meta}>{draft.state} · revision {revision?.version ?? "?"}</div>{revision && <><pre className={styles.preview}>{revision.body}</pre><small>Claims: {revision.claimIds.join(", ")}</small></>}</div><div className={styles.actions}>{draft.state === "draft" && revision && <><button disabled={busy !== null} onClick={() => void reviewDraft(draft, "approve")}>Approve exact revision</button><button className={styles.secondary} disabled={busy !== null} onClick={() => void reviewDraft(draft, "reject")}>Reject</button></>}{draft.state === "approved" && <button disabled={busy !== null} onClick={() => void createGmailDraft(draft)}>{busy === `gmail-${draft.id}` ? "Creating…" : "Create Gmail draft"}</button>}</div></article>; })}</div>
    </section>}

    <footer className={styles.safety}>Company-first means no fake opening. Public contact evidence only. Low-volume reviewed drafts only. No autonomous email send.</footer>
  </main>;
}
