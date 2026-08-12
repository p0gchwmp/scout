# Scout — Internship Application Copilot

Scout is an evidence-first internship discovery and application assistant. It discovers roles from public ATS feeds, ranks them against a verified candidate profile, creates a 5–10 role daily queue, and gates every external action behind explicit approval and submission-safety rules.

## What is included

- Interactive responsive dashboard with daily queue, explainable scores, filters, save/approve actions, and batch approval.
- Greenhouse and Lever public discovery adapters with normalized output.
- Deterministic ranking and eligibility logic; LLM-generated prose is intentionally not trusted for eligibility decisions.
- D1 schema for jobs, profile evidence, application state, blockers, and confirmation records.
- Discovery and job-state API routes with duplicate protection.
- Chrome Manifest V3 safe-fill helper for allowlisted ATS domains.
- Importable n8n daily discovery and Telegram notification workflow.
- Unit and production-render tests.

## Local development

Requires Node.js 22. Install dependencies with `npm ci`, then run `npm run dev`. Generate a D1 migration after schema changes with `npm run db:generate`. The Chrome helper can be loaded as an unpacked extension from the `extension` directory.

The n8n workflow expects `SCOUT_URL` and `TELEGRAM_CHAT_ID` environment values plus a Telegram credential selected after import. Add real company board tokens as a controlled source list before activating the schedule.

## Safety model

Discovery adapters never imply submission permission. The extension refuses expired tasks, unapproved domains, sensitive questions, and unverified answers. LinkedIn and other authenticated platforms are not scraped or automated. CAPTCHA, MFA, demographic/self-ID, legal consent, salary, and work-authorization questions always require user confirmation.
