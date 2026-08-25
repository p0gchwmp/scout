import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { OpportunityQualityWorkspace } from "./quality-client";

export default async function QualityPage() {
  const user = await requireChatGPTUser("/quality");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <OpportunityQualityWorkspace />;
}
