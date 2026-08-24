import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ReviewQueue } from "./review-client";

export default async function ReviewPage() {
  const user = await requireChatGPTUser("/review");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ReviewQueue />;
}
