import { getScoutOwnerUserId, requireChatGPTUser } from "./chatgpt-auth";
import { Dashboard } from "./dashboard";
import { requireScoutPageOwner } from "./scout-api";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <Dashboard />;
}
