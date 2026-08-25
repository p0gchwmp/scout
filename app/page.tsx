import Link from "next/link";
import { getScoutOwnerUserId, requireChatGPTUser } from "./chatgpt-auth";
import { Dashboard } from "./dashboard";
import { requireScoutPageOwner } from "./scout-api";

const workspaceLinks = [
  ["Inbox", "/inbox"],
  ["Sources", "/sources"],
  ["Evidence", "/evidence"],
  ["Preferences", "/preferences"],
  ["Shortlist", "/shortlist"],
  ["Applications", "/applications"],
  ["Readiness", "/readiness"],
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
