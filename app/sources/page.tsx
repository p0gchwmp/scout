import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { SourceHealthWorkspace } from "./source-client";

export default async function SourcesPage() {
  const user = await requireChatGPTUser("/sources");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <SourceHealthWorkspace />;
}
