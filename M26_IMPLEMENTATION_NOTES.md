# M26 — Personio Structured ATS Adapter

## Goal
Add Personio as a controlled structured ATS source using only Personio's documented public published-jobs XML surface.

## Public surface
Personio currently documents `https://{tenant}.jobs.personio.de/xml?language=en` for published positions. Scout does not use Personio candidate/application write APIs for this adapter.

## Adapter
`lib/personio-adapter.ts`
- exact tenant validation
- fixed `*.jobs.personio.de` host only
- public XML feed only
- 10 second timeout
- 1.5 MB response cap
- 500-position cap
- parses `<workzag-jobs><position>`
- derives exact candidate URL `/job/{numeric-id}`
- normalizes title, description, office, workplace type and creation timestamp
- exact job URL parser rejects query strings, fragments, credentials, ports, non-HTTPS, wrong hosts and nonnumeric IDs
- no application submission
- no candidate creation
- no credentials/API key

## Persistence migration
`drizzle/0011_personio_sources.sql` expands only the `company_sources.provider` CHECK constraint to include `personio`, preserving existing rows and the unique provider/token index.

## Safety boundaries
- public published jobs only
- no Recruiting API write endpoint
- no arbitrary URL fetch
- no candidate submission
- no contact harvesting
- exact tenant + external-id evidence binding expected in downstream plumbing
- immutable Scout snapshots remain source of truth

## Verification
- adapter regression suite included
- migration added to the journal
- full repository CI/release gate required before merge
