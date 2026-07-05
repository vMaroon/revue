// Per-comment chat: seeds or resumes the comment's Agent SDK session and
// keeps comment.chat / comment.chatSessionId in sync. Contract:
// ChatService in server/src/interfaces.ts; spec: docs/PIPELINE.md.

import type { ChatMessage } from '@revue/shared';
import type { ChatService } from '../interfaces';
import { readPreference } from '../config';
import { buildSeedPrompt, buildSystemPrompt, extractRevised } from './prompts';

function voiceMd(): string {
  return readPreference('voice');
}

export function createChatService(): ChatService {
  return {
    async send(draft, comment, message, deps) {
      const userMsg: ChatMessage = {
        role: 'user',
        content: message,
        at: new Date().toISOString(),
      };
      comment.chat.push(userMsg);
      comment.updatedAt = userMsg.at;
      deps.save();

      const prompt = comment.chatSessionId
        ? message
        : buildSeedPrompt(comment, voiceMd(), readPreference('learnings'), message);

      const result = await deps.invoker.run({
        model: deps.config.models.chat,
        prompt,
        systemPrompt: buildSystemPrompt(),
        cwd: deps.workdir,
        readOnly: true,
        resume: comment.chatSessionId,
        maxTurns: 20,
        tag: 'chat',
        onDelta: (delta) =>
          deps.emit({ type: 'chat-delta', reviewId: draft.id, commentId: comment.id, delta }),
      });

      const { display, revisedBody } = extractRevised(result.text);
      const reply: ChatMessage = {
        role: 'assistant',
        content: display,
        at: new Date().toISOString(),
      };
      comment.chat.push(reply);
      if (result.sessionId !== undefined) {
        comment.chatSessionId = result.sessionId;
      }
      comment.updatedAt = reply.at;
      deps.save();
      deps.emit({
        type: 'chat-done',
        reviewId: draft.id,
        commentId: comment.id,
        reply,
        revisedBody,
      });

      return { reply, revisedBody };
    },
  };
}
