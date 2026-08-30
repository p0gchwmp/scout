import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { OutcomesWorkspace } from "./outcomes-client";

export default async function OutcomesPage() {
  const user = await requireChatGPTUser("/outcomes");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <OutcomesWorkspace />;
}
