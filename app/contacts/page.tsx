import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ContactIntelligenceWorkspace } from "./contact-intelligence-client";

export default async function ContactsPage() {
  const user = await requireChatGPTUser("/contacts");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ContactIntelligenceWorkspace />;
}
