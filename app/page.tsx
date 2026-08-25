import Link from "next/link";
import { getScoutOwnerUserId, requireChatGPTUser } from "./chatgpt-auth";
import { Dashboard } from "./dashboard";
import { requireScoutPageOwner } from "./scout-api";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <>
    <div style={{ width: "min(1160px, 91vw)", margin: "18px auto -6px", display: "flex", justifyContent: "flex-end", gap: 16, flexWrap: "wrap" }}>
      <Link href="/shortlist" style={{ color: "#234d36", fontSize: 12, fontWeight: 750, textDecoration: "none" }}>Shortlist Intelligence →</Link>
      <Link href="/readiness" style={{ color: "#234d36", fontSize: 12, fontWeight: 750, textDecoration: "none" }}>Application Readiness →</Link>
    </div>
    <Dashboard />
  </>;
}
