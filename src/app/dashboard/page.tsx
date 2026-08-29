import { ChatView } from "@/components/chat/chat-view";
import { fetchCurrentUser } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/**
 * The front door: a new conversation.
 *
 * The project list moved to `/dashboard/projects`. Nothing is lost — the
 * sidebar links it, and the agent reaches the same data through its tools —
 * but a list of folders is not what this product is for. You talk to it.
 */
export default async function ChatHomePage() {
  const user = await fetchCurrentUser();

  return (
    <div className="h-full">
      <ChatView fullName={user.full_name} email={user.email} />
    </div>
  );
}
