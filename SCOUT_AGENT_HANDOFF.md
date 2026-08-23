# Scout Agent Handoff

Use this file to continue Scout with another coding agent (Hermes, Codex, Claude Code, OpenCode, DeepSeek harness, etc.). Treat it as a working handoff, not as permission to commit, push, deploy, contact recruiters, send emails, or submit applications.

## Current project

- Repository: `C:\Users\GIGABYTE\Documents\Codex\2026-08-12\i-wanna-build-an-ai-bot`
- Branch: `feat/discovery-contact-mvp`
- Latest committed base: `3f538d5 feat(scout): add controlled discovery and outreach drafting`
- Runtime stack: Vinext + React 19 + Drizzle + Cloudflare D1/Wrangler
- Package scripts:
  - `npm run dev`
  - `npm run test:unit`
  - `npm run build`
  - `npm test`
  - `npm run lint`
  - `npm run db:generate`

## Current uncommitted work

Resume-tuned Scout preview layer, currently local and uncommitted:

- Modified: `app/dashboard.tsx`
  - Loads approved candidate claims from `/api/claims` alongside jobs and sources.
  - Computes resume-alignment bands for persisted jobs.
  - Replaces generic “unranked” view with a resume-aware shortlist when approved claims exist.
  - Shows evidence overlap themes and explicit unsupported requirements.
- Modified: `app/globals.css`
  - Adds alignment label colors and evidence-basis styling.
  - Preserves mobile visibility for job-card alignment labels.
- Modified: `tests/scout.test.ts`
  - Adds coverage for resume alignment based only on approved claim text.
  - Verifies unsupported requirements are shown as gaps.
- New: `lib/scout/resume-alignment.ts`
  - Deterministic local matcher; no external LLM call.
  - Outputs `strong`, `partial`, `stretch`, or `unranked`.
  - Uses conservative theme overlap and blocks on hard unmet requirements like CS degree or driver’s licence when not evidenced.

Working tree status when this file was written:

```text
## feat/discovery-contact-mvp
 M app/dashboard.tsx
 M app/globals.css
 M tests/scout.test.ts
?? lib/scout/resume-alignment.ts
?? SCOUT_AGENT_HANDOFF.md
```

## Verified status

The following passed after the resume-lens changes:

```bash
node --experimental-strip-types --test --test-name-pattern="resume alignment" tests/scout.test.ts
npm test
npm run lint
git diff --check
```

Observed result:

- Unit tests: 19/19 passing.
- Production build: passing.
- Rendered HTML auth test: passing.
- ESLint: passing.
- `git diff --check`: passing.

## Local preview state

A local preview was opened at:

```text
http://localhost:4174/?resume=2
```

Preview data was local-only:

- 3 seeded Greenhouse postings:
  - Stripe — Software Engineer, Intern — Bengaluru
  - Samsara — Data Annotator, Fresh Graduate — Bengaluru
  - Canonical — Graduate Customer Success Manager — worldwide remote
- 8 approved resume claims were seeded into the local preview database only.

Important: the local preview seed is for demonstration. Do not treat it as production migration data unless Ryan explicitly approves a durable candidate-profile/import feature.

## Product/security invariants

Do not weaken these:

1. Scout is owner-only and fail-closed via `SCOUT_OWNER_USER_ID`.
2. Browser mutations require same-origin checks.
3. Discovery is restricted to controlled/registered Greenhouse sources.
4. Contact extraction uses persisted Greenhouse posting content or fixed Greenhouse API evidence boundaries only.
5. Do not fetch arbitrary careers pages for emails.
6. Do not infer or fabricate email addresses.
7. Only accepted contact evidence can be used for drafts.
8. Candidate claims must be immutable/versioned and approved before use in outreach.
9. Outreach drafts are deterministic, immutable revisions pinned to job snapshot, contact evidence, and approved claim IDs.
10. There is no send/apply route. Do not add one without a separate explicit approval and safety review.
11. Do not commit, push, deploy, send outreach, contact recruiters, submit applications, activate n8n, or hand work to a browser extension without explicit Ryan approval.
12. Do not invent resume facts, scores, eligibility, work authorization, driver’s licence, CS degree, or completed fieldwork.

## Ryan’s verified resume boundaries

Use only verified evidence. Preserve these distinctions:

- IIM Sambalpur Management & Public Policy, expected 2029.
- Semester I CGPA is remembered as 8.25, but should be checked before external use.
- GMC Jammu work: adverse-drug-reaction data review, technical documentation, desk research on antibiotic price disparities.
- Hand-hygiene work: single-site exploratory pilot design, synopsis/questionnaire/checklist prepared; fieldwork is planned/resuming, not completed fieldwork.
- Aastha clinic/CMS: product direction/design and AI-assisted implementation; do not claim sole manual coding.
- Clinic operations prototype: Node.js/Express/SQLite multi-clinic operations prototype; mapped workflow edge cases and validated with automated tests.
- Scout: tested prototype/product requirements and safety model; not an operational autonomous agent and no completed autonomous applications.
- Policy coursework: NAP-AMR local implementation analysis and proposed governance/stewardship measures.

## Current model/provider context

At the time this handoff was created, this chat’s active runtime metadata says:

```text
provider: openai-codex
model: gpt-5.5
```

Hermes provider configuration has recently been changed around because Codex/Gemini limits were hit. Before starting long work, verify live config with:

```bash
hermes config get model.provider
hermes config get model.default
hermes status
```

If using local/offline work, prefer a non-Codex harness for heavy coding to preserve Ryan’s OpenAI quota.

## How to continue with another agent

### Option A — Hermes one-shot from repo

```bash
cd "C:/Users/GIGABYTE/Documents/Codex/2026-08-12/i-wanna-build-an-ai-bot"
hermes chat -q "Read SCOUT_AGENT_HANDOFF.md. Continue Scout safely. Do not commit, push, deploy, send outreach, contact recruiters, or submit applications. First run git status and the test commands before making changes."
```

### Option B — Hermes interactive agent in tmux

```bash
tmux new-session -d -s scout-agent -x 140 -y 45 'cd "C:/Users/GIGABYTE/Documents/Codex/2026-08-12/i-wanna-build-an-ai-bot" && hermes'
sleep 8
tmux send-keys -t scout-agent 'Read SCOUT_AGENT_HANDOFF.md and continue from there. Preserve all safety gates. Do not commit/push/deploy/send/apply without explicit Ryan approval.' Enter
tmux capture-pane -t scout-agent -p | tail -80
```

### Option C — Codex/Claude/OpenCode/DeepSeek harness prompt

Paste this into the other agent after opening the repository:

```text
You are continuing Scout, a private internship discovery and outreach-drafting copilot for Ryan Vivek Mahajan.

Repository: C:\Users\GIGABYTE\Documents\Codex\2026-08-12\i-wanna-build-an-ai-bot
Branch: feat/discovery-contact-mvp

Read SCOUT_AGENT_HANDOFF.md first. Then run:
- git status --short --branch
- npm run test:unit
- npm run lint

Do not commit, push, deploy, send outreach, contact recruiters, submit applications, activate n8n, or weaken authentication without explicit approval from Ryan.

Main current task: improve the resume-aware Scout shortlist safely. It must use approved resume claims, explicit evidence themes, and explicit gaps. It must not invent scores or qualifications.

Keep the existing security invariants:
- fail-closed owner auth using SCOUT_OWNER_USER_ID
- same-origin mutation protection
- controlled Greenhouse source registry only
- contact evidence provenance
- immutable/versioned claims
- deterministic outreach draft revisions
- no send/apply capability

Before final response, run the relevant verification commands and report exact outputs honestly.
```

## Suggested next improvements

These are safe next steps, in order:

1. Persist a real candidate-profile import flow instead of local-only seed scripts.
2. Add a “Claims” dashboard section so Ryan can review/approve/edit resume claims in the UI.
3. Make the resume-alignment output more transparent: show which exact claim IDs supported each theme.
4. Add tests ensuring draft generation uses only approved claim IDs and rejects stale claim versions.
5. Add a local reset/seed command for demos that cannot run in production accidentally.
6. Add more ATS adapters only after keeping the same registry/provenance constraints.
7. Expand the controlled source registry, but keep it official-source-only and low-volume.

## Commands for final verification

Before any commit proposal, run:

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

If deployment is later approved, deployment still requires `SCOUT_OWNER_USER_ID` and a separate go/no-go review.
