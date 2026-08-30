import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { OpportunityCommandCenter } from "./command-center-client";

export default async function CommandCenterPage() {
  const user = await requireChatGPTUser("/command-center");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <OpportunityCommandCenter />;
}
