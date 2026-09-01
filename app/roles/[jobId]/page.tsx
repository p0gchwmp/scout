import Link from "next/link";
import { getScoutOwnerUserId, requireChatGPTUser } from "../../chatgpt-auth";
import { requireScoutPageOwner } from "../../scout-api";
import { RoleDecisionCockpit } from "./role-cockpit-client";

export default async function RolePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const user = await requireChatGPTUser(`/roles/${jobId}`);
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <>
    <nav style={{ maxWidth: 1180, margin: "18px auto -8px", padding: "0 24px" }}><Link href={`/roles/${jobId}/timeline`}>Open role timeline →</Link></nav>
    <RoleDecisionCockpit jobId={jobId} />
  </>;
}
