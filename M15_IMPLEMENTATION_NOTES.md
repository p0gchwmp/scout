# M15 — Official Lead Promotion

## Goal
Connect Scout's existing official ATS resolver to the product so an explicitly selected ecosystem/search lead can become a first-class Scout job only after independent official evidence verification.

## Core flow
1. Owner runs ephemeral ecosystem discovery.
2. Owner selects one lead and supplies/confirms the employer name when the lead is a portfolio board or unregistered ecosystem result.
3. Scout uses the existing server-derived official-resolution search queries.
4. Scout accepts only supported official ATS URLs (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, BambooHR, Recruitee, Teamtailor, Breezy).
5. Scout re-fetches the official ATS posting and independently checks company/title evidence.
6. Only that re-fetched official posting is persisted.
7. The independently verified ATS source may be registered automatically because it is now a controlled source. The original VC board/search page is not auto-trusted or registered as employer evidence.
8. Scout creates or refreshes the immutable job snapshot and routes the role into the existing Quality → Readiness → Safe Fill / contact-review pipeline.

## Persistence rule
- Search snippet: not persisted.
- Original ecosystem/portfolio lead: not persisted as job evidence.
- Official ATS source: may be registered after independent verification.
- Official ATS posting: persisted as immutable job snapshot.
- Same official content hash: existing snapshot is reused rather than duplicated.

## Safety
No guessed contacts, personal-contact scraping, automatic contact acceptance, Gmail draft creation, email sending, or application submission is added by M15.
