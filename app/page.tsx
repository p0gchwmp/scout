import Link from "next/link";
import { getScoutOwnerUserId, requireChatGPTUser } from "./chatgpt-auth";
import { Dashboard } from "./dashboard";
import { requireScoutPageOwner } from "./scout-api";

const workspaceLinks = [
  ["Start Here", "/start"],
  ["Run Scout", "/run"],
  ["Command Center", "/command-center"],
  ["Ecosystem", "/ecosystem"],
  ["External Leads", "/external-leads"],
  ["Inbox", "/inbox"],
  ["Sources", "/sources"],
  ["Evidence", "/evidence"],
  ["Preferences", "/preferences"],
  ["Quality", "/quality"],
  ["Roles", "/roles"],
  ["Shortlist", "/shortlist"],
  ["Applications", "/applications"],
  ["Outcomes", "/outcomes"],
  ["Readiness", "/readiness"],
  ["Contacts", "/contacts"],
  ["Company Outreach", "/company-outreach"],
  ["Review", "/review"],
  ["Safe Fill", "/assist"],
  ["Voice", "/voice"],
] as const;

export default async function Home() {
  const user = await requireChatGPTUser("/");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <div className="dashboard-shell">
    <header className="dashboard-topbar">
      <Link href="/" className="dashboard-brand">Scout</Link>
      <nav className="workspace-links" aria-label="Scout workspaces">
        {workspaceLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <span className="owner-badge">Private · owner only</span>
    </header>
    <Dashboard />
  </div>;
}
