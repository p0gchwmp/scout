import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { BrowserAssist } from "./assist-client";

export default async function AssistPage() {
  const user = await requireChatGPTUser("/assist");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <BrowserAssist />;
}
