import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { EvidenceWorkspace } from "./evidence-client";

export default async function EvidencePage() {
  const user = await requireChatGPTUser("/evidence");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <EvidenceWorkspace />;
}
