# Scout Deep Agent Handoff

This is the detailed continuation brief for any future coding agent: Hermes, Codex, Claude Code, OpenCode, Cursor, Aider, DeepSeek harness, or a local/offline agent. It is intentionally explicit because Scout is a permission-gated internship discovery and outreach-drafting system where the difference between “useful contact discovery” and spammy/unsafe scraping matters.

**This handoff is context, not permission.** It does not authorize commits, pushes, deployments, recruiter contact, email sending, application submission, n8n activation, paid API use, or browser-extension task execution.

---

## 0. One-paragraph mission

Scout is Ryan Vivek Mahajan’s private internship discovery and outreach copilot. It should discover legitimate internships and early-career roles from controlled public sources, normalize and persist postings, find legitimate public business/recruiter contact evidence where available, compare postings against Ryan’s approved resume claims without inventing fit, draft low-volume personalized outreach for Ryan to review, and stop before any external side effect. Scout should be useful for both “cool” companies and “boring” but legitimate companies — B2B SaaS, healthcare operations, clinics/hospitals, finance/economics orgs, public-policy orgs, logistics, manufacturing, compliance, local businesses, startups, and well-known tech firms — as long as sources are legitimate and the outreach remains respectful and approved.

---

## 1. Current local project state

- Repository: `C:\Users\GIGABYTE\Documents\Codex\2026-08-12\i-wanna-build-an-ai-bot`
- Branch: `feat/discovery-contact-mvp`
- Latest committed base: `3f538d5 feat(scout): add controlled discovery and outreach drafting`
- Current stack: Vinext + React 19 + Drizzle ORM + Cloudflare D1/Wrangler
- Local preview previously opened at: `http://localhost:4174/?resume=2`
- Compact handoff already exists: `SCOUT_AGENT_HANDOFF.md`
- This deep handoff: `SCOUT_DEEP_AGENT_HANDOFF.md`

Current uncommitted files when this handoff was written:

```text
 M app/dashboard.tsx
 M app/globals.css
 M tests/scout.test.ts
?? SCOUT_AGENT_HANDOFF.md
?? SCOUT_DEEP_AGENT_HANDOFF.md
?? lib/scout/resume-alignment.ts
```

The uncommitted changes are mainly the resume-aware UI/lens and handoff documentation.

---

## 2. Runtime/model context

The active chat runtime recently reported:

```text
provider: openai-codex
model: gpt-5.5
```

Hermes gateway/default config was earlier switched to:

```text
provider: ollama-launch
model: minimax-m3:cloud
```

Before doing long work, verify live state rather than relying on memory:

```bash
hermes config get model.provider
hermes config get model.default
hermes status
```

Ryan prefers free/self-hosted/local tooling when practical. Preserve cloud quota by using local scripts/tests for mechanical work and cloud models only for hard decisions, patch design, and review.

---

## 3. What Scout currently does

The committed MVP already added a controlled discovery/contact/draft vertical:

1. Controlled source registry for company job boards.
2. Greenhouse ingestion with fixed official API boundaries.
3. Persistent D1-backed sources, jobs, sync runs, snapshots, contacts, candidate claims, and outreach drafts.
4. Composite source identity and lifecycle tracking.
5. Immutable job snapshots and current-snapshot tracking.
6. Conservative job closure logic — no mass-closing on failed/empty/suspicious syncs.
7. Public business/recruiter email evidence extraction from approved persisted content only.
8. Candidate claims with approval/versioning.
9. Deterministic outreach draft revisions pinned to job snapshot, accepted contact, and approved claim IDs.
10. Owner-only auth and same-origin mutation protections.
11. No send route and no application-submission route.

---

## 4. Current uncommitted resume-lens work

### Files changed

#### `lib/scout/resume-alignment.ts`

New deterministic local module. It does not call an LLM. It compares posting text against approved claim text and returns:

- `strong`
- `partial`
- `stretch`
- `unranked`

It uses conservative theme overlap:

- Product & operations
- Research & analysis
- Technical delivery
- Quality & documentation
- Healthcare & public policy
- Stakeholder support

It also reports explicit gaps when the job asks for something not evidenced in approved claims, e.g.:

- computer-science-related degree
- driver’s licence
- direct customer-facing experience

Hard unmet requirements can make a role a “Stretch role” even when there are several theme overlaps. This is deliberate: Scout should never hide a serious eligibility risk behind a flattering score.

#### `app/dashboard.tsx`

Now loads `/api/claims` alongside jobs/sources. If approved claims exist, it shows a resume-aware shortlist instead of generic unranked cards:

- hero changes to “Approved resume lens”
- shows number of approved claims
- sorts jobs by alignment band
- each job card shows overlap themes, gaps, and claim-count basis

#### `app/globals.css`

Adds alignment styles and ensures mobile job-card labels remain visible.

#### `tests/scout.test.ts`

Adds regression coverage that resume alignment:

- uses approved claim text only;
- reports unsupported requirements as gaps;
- does not imply unsupported eligibility.

### Last verified result

After these changes, these commands passed:

```bash
node --experimental-strip-types --test --test-name-pattern="resume alignment" tests/scout.test.ts
npm test
npm run lint
git diff --check
```

Observed summary:

- Unit tests: 19/19 passing.
- Production build: passing.
- Rendered HTML auth test: passing.
- ESLint: passing.
- `git diff --check`: passing.

Before any commit or handoff claim, rerun the relevant gates.

---

## 5. Ryan’s candidate profile boundaries

Use only evidence from Ryan’s approved resume materials. Do not inflate.

Known profile:

- Name: Ryan Vivek Mahajan
- Student: IIM Sambalpur, Management & Public Policy, 2025–2029 inaugural cohort
- Location: Jammu
- Semester I CGPA remembered as 8.25; verify against official record before external use
- Interests: product/startups, finance/economics, public policy, health-tech, operations
- Preferred writing: understated, direct, human, professional, no corporate fluff

Resume boundaries that must be preserved:

1. **GMC Jammu**
   - Valid: adverse-drug-reaction data review, technical documentation, desk research on antibiotic price disparities.
   - Do not claim: completed clinical research project or large-scale published research unless verified.

2. **Hand-hygiene work**
   - Valid: designed single-site exploratory pilot, synopsis/questionnaire/facility checklist prepared.
   - Do not claim: completed fieldwork or final results. Fieldwork was planned/resuming.

3. **Aastha clinic/CMS**
   - Valid: product direction/design and AI-assisted implementation; Django/Wagtail website/CMS; QA/deployment checks.
   - Do not claim: sole manual engineering of all code.

4. **Clinic operations prototype**
   - Valid: Node.js/Express/SQLite multi-clinic operations prototype, workflow mapping, edge cases, automated tests.
   - Keep prototype/deployed wording accurate depending on the exact artifact.

5. **Scout**
   - Valid: product requirements, safety model, TypeScript prototype validation.
   - Do not claim: operational autonomous application-sending agent.

6. **Policy coursework**
   - Valid: NAP-AMR local implementation analysis and governance/stewardship recommendations.

7. **Technical skills**
   - Valid only where evidenced: Excel, Power BI, SPSS, Python, JavaScript, Git, QA/testing, technical documentation, product requirements.

---

## 6. Contact discovery and email collection: core product scope, but with hard safety boundaries

Ryan wants email/contact discovery to be a **core part** of Scout. That is acceptable if implemented as legitimate, provenance-based contact discovery — not mass scraping or private-data harvesting.

### Product goal

Scout should help Ryan find appropriate contact channels for internships and early-career opportunities, especially when official application portals are noisy or unresponsive. It should support low-volume, personalized outreach to relevant business/recruiting contacts after Ryan reviews and approves the evidence and draft.

The system should work for:

- “Cool” companies: tech startups, AI/health-tech, fintech, product-led SaaS, policy labs, venture-backed companies.
- “Boring but useful” companies: clinics, hospital groups, compliance firms, logistics companies, manufacturing businesses, B2B services, local firms, public-policy NGOs, research groups, finance/economics organizations.

### Allowed contact sources

Only collect contact evidence from legitimate public business sources, with exact provenance:

1. Official job postings and ATS content.
2. Official company careers pages.
3. Official company contact/recruiting pages.
4. Official university/career-fair listings where public recruiter emails are posted.
5. Official company blog/team pages if they publish business emails.
6. Public press releases or event pages listing company representatives with business emails.
7. Public recruiter posts/pages only if the business email is explicitly published and capture is compliant with the site’s terms.

Every stored contact must include:

- email address;
- exact source URL;
- source type;
- extraction timestamp;
- excerpt surrounding the email;
- associated company/source/job if any;
- suitability classification;
- review status: `needs_review`, `accepted`, or `rejected`;
- reason for suitability/rejection.

### Disallowed contact collection

Do **not** implement or run:

1. Mass scraping of LinkedIn profiles.
2. Scraping LinkedIn for private/personal HR emails.
3. Scraping authenticated pages, pages behind login, CAPTCHA, rate limits, or anti-bot systems.
4. Data brokers or enrichment tools like Apollo/Hunter/Clearbit-style enrichment unless Ryan explicitly approves and legal/compliance has been considered.
5. Guessing emails from name patterns (`first.last@company.com`) unless the address is independently published and verified.
6. Consumer/personal mailbox targeting (`gmail.com`, `yahoo.com`, `icloud.com`, etc.) for HR/recruiter outreach.
7. Bulk cold email campaigns.
8. Automated sending.
9. Contacting recruiters without explicit Ryan approval for each batch/draft.
10. Scraping personal phone numbers, WhatsApp numbers, private addresses, or sensitive demographic data.

### LinkedIn-specific rule

LinkedIn can be useful as a **manual discovery clue** — e.g. identifying that a company has recruiters or what recruiting titles exist — but Scout should not mass scrape LinkedIn profiles or harvest emails from LinkedIn. If a future feature uses LinkedIn at all, keep it to one of these safer patterns:

- Store a manually reviewed LinkedIn profile URL as a non-email lead, not as sendable contact evidence.
- Use it only to decide which official company recruiting page to inspect.
- If a recruiter publicly posts a business email in a way that is accessible and compliant, store it only with exact URL/excerpt and `needs_review`; do not auto-accept it.

Phrase for future agents:

> Email discovery is a core feature, but not unrestricted scraping. Build a provenance-first public business email collector. Do not build a LinkedIn email scraper or HR spam engine.

### Cold outreach policy

Scout may draft cold outreach, but must not send.

Outreach should be:

- low-volume;
- role/company-specific;
- based on approved resume claims;
- short and non-pushy;
- clearly from Ryan;
- transparent about student status and prototype/project experience;
- reviewed and approved by Ryan before any send;
- tracked with suppression/opt-out once sending exists.

Drafts must not include:

- invented credentials;
- inflated metrics;
- false work authorization;
- false availability;
- false referrals;
- pressure tactics;
- hidden mass-mailing language;
- misleading subject lines.

A future send system, if ever approved, needs a separate safety review and should include:

- per-recipient approval;
- rate limits;
- suppression list;
- unsubscribe/stop-contact handling;
- audit log;
- bounce/error tracking;
- no repeated follow-ups without approval.

---

## 7. Existing security/product invariants

Never weaken these:

1. Scout is owner-only and fail-closed via `SCOUT_OWNER_USER_ID`.
2. All pages and API routes require authenticated owner context.
3. Browser mutations require same-origin validation (`Origin` / `Sec-Fetch-Site`).
4. Discovery sources are controlled and registered; do not accept arbitrary board tokens from clients.
5. Contact evidence must be provenance-bound.
6. Only accepted contact evidence can be used for outreach drafts.
7. Candidate claims are immutable/versioned and require approval.
8. Drafts are deterministic immutable revisions pinned to job snapshot, contact evidence, and approved claim IDs.
9. No send/apply route exists.
10. No deployment without `SCOUT_OWNER_USER_ID` and explicit Ryan approval.
11. No external action because a Discord message “sounds positive”; explicit authorization is required.
12. Errors exposed to the UI/API should be stable and not leak raw internals/secrets.

---

## 8. Recommended next implementation plan

If the next agent is asked to “make it further,” use this order.

### Phase 1 — stabilize current local state

1. Run:

```bash
git status --short --branch
npm run test:unit
npm run lint
```

2. Read:

```text
SCOUT_AGENT_HANDOFF.md
SCOUT_DEEP_AGENT_HANDOFF.md
lib/scout/resume-alignment.ts
app/dashboard.tsx
tests/scout.test.ts
```

3. Do not modify auth, deployment, or send/apply surfaces.

### Phase 2 — turn resume seed into real UI

Build a Claims tab/section:

- list claims by status;
- show statement/evidence/version;
- allow editing only draft claims;
- approve/reject with expected version;
- show approved claim count;
- show warning that approved claims are used for outreach drafts.

Tests:

- malformed claim payloads still return 400;
- stale expected version returns 409;
- approved claims cannot be edited;
- dashboard renders Claims tab for authenticated owner.

### Phase 3 — make alignment more explainable

Improve `resume-alignment.ts` to return:

- band;
- label;
- matches;
- gaps;
- basis;
- supporting claim IDs per theme;
- explicit “not checked” caveats.

UI should show:

- each overlap theme;
- claim IDs/evidence titles supporting it;
- gaps separately;
- no numeric score unless carefully justified.

Tests:

- exact claim IDs are returned;
- rejected/draft claims are ignored;
- hard gaps downgrade role band;
- no claims returns `unranked`.

### Phase 4 — contact discovery expansion, safely

Build a source registry for contact pages separate from job source registry:

Possible schema additions:

```text
contact_sources
- id
- company_id/source_id
- source_type: official_careers | official_contact | ats_posting | event_page | press_release | manual_reviewed
- url
- domain
- enabled
- created_at
- updated_at

contact_evidence
- id
- job_id nullable
- company_source_id
- contact_source_id nullable
- email
- normalized_domain
- source_url
- source_excerpt
- extracted_at
- suitability
- status: needs_review | accepted | rejected
- rejection_reason nullable
- content_hash
```

Important:

- use allowlisted domains;
- block private IPs and redirects to unexpected hosts;
- cap response size/time;
- store content hash and excerpt;
- never infer emails;
- reject personal/consumer domains;
- require review before use.

### Phase 5 — low-volume outreach workflow

Only after contact evidence and claims are approved:

- generate deterministic draft;
- pin job snapshot ID;
- pin accepted contact evidence ID;
- pin sorted approved claim IDs;
- store body hash;
- allow approve/reject only;
- no free-form editing that keeps stale pins.

Do not add send.

### Phase 6 — production/deploy preparation

Only after Ryan explicitly approves:

- set `SCOUT_OWNER_USER_ID` in deployment environment;
- run full tests;
- run independent review;
- deploy only private owner-authenticated version;
- verify unauthenticated access fails closed.

---

## 9. Agent prompt to paste into DeepSeek/Codex/Claude/OpenCode

Paste this into the other agent from inside the repo:

```text
You are continuing Scout, Ryan Vivek Mahajan’s private internship discovery and outreach-drafting copilot.

Repository: C:\Users\GIGABYTE\Documents\Codex\2026-08-12\i-wanna-build-an-ai-bot
Branch: feat/discovery-contact-mvp

First read:
- SCOUT_AGENT_HANDOFF.md
- SCOUT_DEEP_AGENT_HANDOFF.md

Then run:
- git status --short --branch
- npm run test:unit
- npm run lint

Do not commit, push, deploy, send outreach, contact recruiters, submit applications, activate n8n, weaken authentication, or use paid services without explicit Ryan approval.

Scout’s long-term product includes contact/email discovery and cold outreach drafting, but this must be done safely:
- collect only explicitly published public business/recruiter emails;
- store exact source URL, excerpt, extraction timestamp, source type, suitability and review status;
- do not scrape LinkedIn profiles for emails;
- do not harvest private/personal emails;
- do not infer email patterns;
- do not use data brokers/enrichment tools unless separately approved;
- do not send emails automatically;
- keep outreach low-volume, personalized, evidence-backed and Ryan-approved.

Current near-term task: make the resume-aware shortlist and candidate-claims workflow more real, reviewable and transparent. Use approved resume claims only. Show evidence themes and gaps. Do not invent scores or qualifications.

Maintain all existing security invariants:
- fail-closed owner auth with SCOUT_OWNER_USER_ID;
- same-origin mutation protection;
- controlled source registry;
- immutable job snapshots;
- immutable/versioned candidate claims;
- deterministic outreach draft revisions;
- no send/apply route.

Before final response, run the relevant tests/build/lint commands and report exact outputs honestly.
```

---

## 10. Full verification before commit proposal

Before proposing a commit, run:

```bash
npm test
npm run lint
python tests/migration-smoke.py
npm run db:generate
npm run build
git diff --check
git status --short --branch
git diff --stat
```

If any command fails, fix or report the blocker honestly.

A clean verification is not permission to commit. Ask Ryan separately.

---

## 11. What not to do

Do not:

- “just add a send button”; 
- add SMTP/Gmail sending;
- add LinkedIn scraper;
- add Apollo/Hunter-style enrichment;
- scrape HR personal emails;
- auto-apply;
- mass email;
- bypass ATS or CAPTCHA;
- answer sensitive application questions;
- weaken auth for preview;
- deploy publicly;
- commit without Ryan’s explicit approval.

---

## 12. Practical working style for future agents

Ryan values:

- working artifacts over explanations;
- evidence over inflated claims;
- fast but safe iteration;
- understated, professional writing;
- free/self-hosted tooling when practical;
- explicit tradeoffs;
- no fake confidence.

When unsure, say the uncertainty and verify with tools. Do not fabricate outputs or claim tests passed without running them.
