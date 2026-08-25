import { getScoutOwnerUserId, requireChatGPTUser } from "../../chatgpt-auth";
import { requireScoutPageOwner } from "../../scout-api";
import { RoleDecisionCockpit } from "./role-cockpit-client";

export default async function RolePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const user = await requireChatGPTUser(`/roles/${jobId}`);
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <RoleDecisionCockpit jobId={jobId} />;
}
