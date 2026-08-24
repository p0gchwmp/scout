import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { WritingVoice } from "./voice-client";

export default async function VoicePage() {
  const user = await requireChatGPTUser("/voice");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <WritingVoice />;
}
