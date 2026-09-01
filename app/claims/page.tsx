import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ClaimsWorkspace } from "./claims-client";

export default async function ClaimsPage() {
  const user = await requireChatGPTUser("/claims");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ClaimsWorkspace />;
}
