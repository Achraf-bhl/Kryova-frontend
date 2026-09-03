import { notFound } from "next/navigation";

import { ChatView } from "@/components/chat/chat-view";
import { conversationToTurns } from "@/lib/conversation-transcript";
import { fetchConversation, fetchCurrentUser, isNotFound } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/**
 * One conversation, addressed by its id.
 *
 * The id in the URL is the fix for the worst bug in the old product: the
 * transcript was persisted server-side but the id lived in an in-memory ref, so
 * a refresh or a click on any nav link orphaned the conversation permanently.
 * Now the URL owns it, the transcript is rehydrated here on the server, and the
 * thread is in the first paint.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;

  let conversation;
  try {
    conversation = await fetchConversation(conversationId);
  } catch (error) {
    // The backend answers 404 for someone else's conversation too, so this is
    // "not found" and never "not allowed".
    if (isNotFound(error)) notFound();
    throw error;
  }

  const user = await fetchCurrentUser();

  return (
    <div className="h-full">
      <ChatView
        // Remount when the id changes: two conversations are two threads, and
        // React would otherwise reuse the first one's state for the second.
        key={conversation.conversation_id}
        fullName={user.full_name}
        email={user.email}
        conversationId={conversation.conversation_id}
        title={conversation.title}
        projectId={conversation.project_id}
        boundDocument={conversation.catia_document}
        // What was actually *done*, as opposed to what was said — read from the
        // backend's log of the CATIA calls, which is the same source the agent
        // reads when it resumes. One account of the session, not two.
        resume={conversation.resume}
        initialTurns={conversationToTurns(conversation.messages)}
      />
    </div>
  );
}
