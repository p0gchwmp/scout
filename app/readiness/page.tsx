import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ApplicationReadinessWorkspace } from "./readiness-client";

export default async function ApplicationReadinessPage() {
  const user = await requireChatGPTUser("/readiness");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ApplicationReadinessWorkspace />;
}
