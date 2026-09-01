import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ExternalLeadsClient } from "./external-leads-client";

export default async function ExternalLeadsPage() {
  const user = await requireChatGPTUser("/external-leads");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ExternalLeadsClient />;
}
