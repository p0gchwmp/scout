# Scout platform coverage roadmap

Scout should cover the internship ecosystem broadly without pretending every site supports the same type of automation. The platform registry in `lib/scout/platform-registry.ts` is the source of truth for how Scout may interact with each surface.

## Coverage model

Every platform declares five independent decisions:

1. **Discovery** — public API/page, search-index lead, registered source, or user-session capture.
2. **Resolution** — structured snapshot, official-page snapshot, browser capture, or lead-only.
3. **Application** — structured preparation, reviewed browser assistance, reviewed Easy Apply assistance, or manual.
4. **Contact research** — official company sources only, or none on the job board itself.
5. **Submission** — always requires Ryan's explicit approval; no platform gets an autonomous-submit flag.

## Priority 1 — structured ATS adapters

- Greenhouse
- Lever
- Ashby
- Workable
- SmartRecruiters

Goal: scheduled cloud discovery, immutable job snapshots, normalized application questions, approved-profile autofill, and deterministic application packets.

## Priority 2 — browser-assisted ATS adapters

- Workday / `myworkdayjobs`
- BambooHR
- iCIMS
- Jobvite
- Recruitee
- Teamtailor
- Breezy HR
- JazzHR / `applytojob`
- Pinpoint
- Personio
- Rippling ATS
- Freshteam
- Zoho Recruit

Goal: resolve the official job page server-side where practical, then use a reviewed candidate-side browser session to inspect visible fields, fill approved reusable facts, upload the approved resume, and stop on sensitive/unknown questions.

## Priority 3 — job-board lead coverage

- LinkedIn Search
- LinkedIn Easy Apply
- Internshala
- Glassdoor
- Indeed
- Naukri
- Wellfound
- Unstop
- Cutshort
- Foundit

These are valuable discovery surfaces but are not recruiter-email sources. Scout should save job leads and resolve them to official employer/ATS postings where possible.

### LinkedIn specifically

- Search: user-session or search-index lead discovery, not mass automated crawling.
- Easy Apply: reviewed browser assistance may prepare/fill the visible flow, but Scout must respect LinkedIn limits and must not rapidly mass-submit applications.
- Recruiter profiles: context-only. Do not scrape private emails or contact details.
- Final application submission remains approval-gated.

## Priority 4 — enterprise / long-tail ATS

- Oracle Recruiting Cloud
- SAP SuccessFactors
- Oracle Taleo
- ADP Recruiting
- Eightfold
- Phenom
- Avature

Goal: robust official-page recognition and browser-assisted application preparation rather than brittle undocumented API dependencies.

## Contact discovery path

Job boards themselves are not contact-harvesting targets. For every resolved company/role, the agent searches approved official sources such as:

- official job posting / ATS page;
- company careers page;
- official company contact page;
- official recruiting/team page;
- official career-fair/event page;
- press release or other official company page.

Every email candidate requires exact URL + excerpt + timestamp + source type. AI may classify suitability but may never invent or infer an email address.

## AI responsibilities

AI is useful for:

- ranking/disambiguating discovered leads;
- deciding which approved claim IDs best support a role;
- classifying explicitly published contact candidates;
- drafting role/company-specific outreach;
- drafting role-specific application answers;
- identifying uncertain/sensitive questions that require Ryan.

AI is not allowed to:

- invent candidate facts;
- invent recruiter emails;
- scrape private LinkedIn contact data;
- bypass login/CAPTCHA/access controls;
- send email;
- submit an application without an explicit approved action.

## Cloud execution target

Localhost remains dev/test only. Production uses the private Scout control plane plus an internet-connected agent worker. Scheduled discovery should continuously populate the queue so Scout does not depend on Ryan manually saving many leads.
