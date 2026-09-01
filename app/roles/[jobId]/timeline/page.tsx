import { getScoutOwnerUserId, requireChatGPTUser } from "../../../chatgpt-auth";
import { requireScoutPageOwner } from "../../../scout-api";
import { RoleTimeline } from "./role-timeline-client";

export default async function RoleTimelinePage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const user = await requireChatGPTUser(`/roles/${jobId}/timeline`);
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <RoleTimeline jobId={jobId} />;
}
