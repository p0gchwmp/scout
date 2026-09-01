# Run Scout locally

Scout is designed to be private, owner-only, and local-first. The fast local path is:

```bash
npm ci
npm run ready
npm run dev
```

`npm run ready` runs the read-only doctor and then a bounded full startup smoke check. The smoke check uses only loopback services, applies only local D1 migrations through the existing M32 bootstrap, verifies that the owner-authenticated `/setup` page becomes reachable, and shuts the temporary runtime down again.

For a synthetic local workflow instead of an empty workspace:

```bash
npm run dev:demo
```

Useful individual checks:

```bash
npm run doctor
npm run smoke
```

The local run path does not deploy Scout, activate paid providers, send outreach, or submit applications. Existing fail-closed owner authentication and review boundaries remain in force.
