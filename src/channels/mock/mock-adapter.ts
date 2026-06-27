/**
 * MockAdapter — deterministic in-memory channel for tests. Proves the
 * ChannelAdapter abstraction is pluggable without any network. The black-box
 * CLI E2E selects this via OFFICEOS_CHANNEL_ADAPTER=mock so a spawned
 * `officeos onboard` validates credentials with zero Slack calls.
 *
 * Outbound calls append to the JSONL file at OFFICEOS_MOCK_OUTBOX (when set) so
 * a parent test process can assert on what was "sent".
 */
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { getTarget, mostRecentTarget } from '../reply-targets.js';
import type {
  ChannelAdapter,
  InboundHandlers,
  IncomingMessage,
  OutboundTarget,
  ValidationResult,
} from '../adapter.js';

/** Stable fake bot identity. Must differ from any owner id a test scripts. */
export const MOCK_BOT_IDENTITY = 'UBOTMOCK01';

export class MockAdapter implements ChannelAdapter {
  readonly kind = 'mock';

  async validateCredentials(): Promise<ValidationResult> {
    return { ok: true, identity: MOCK_BOT_IDENTITY };
  }

  async sendMessage(target: OutboundTarget, text: string): Promise<{ messageId: string } | null> {
    this.record({ op: 'sendMessage', target, text });
    return { messageId: 'mock-ts-1' };
  }

  async addReaction(target: OutboundTarget, messageId: string, emoji: string): Promise<void> {
    this.record({ op: 'addReaction', target, messageId, emoji });
  }

  resolveReplyTarget(stateDir?: string, requestId?: string): OutboundTarget | null {
    // Lets a test exercise a caller's "no reply target" fallback path.
    if (process.env.OFFICEOS_MOCK_NO_TARGET === '1') return null;
    // Behave like the real adapter: read the per-request store when present so
    // callers' channel/thread-matching logic can be tested through the mock.
    if (stateDir) {
      const t = requestId ? getTarget(stateDir, requestId) : mostRecentTarget(stateDir);
      if (t) return { conversationId: t.conversationId, threadId: t.threadId || undefined };
    }
    return { conversationId: 'C_MOCK', threadId: undefined };
  }

  async start(handlers: InboundHandlers): Promise<void> {
    // Scripted inbound: replay a JSONL file of IncomingMessage objects so an
    // integration test can drive the full inbound loop (adapter → handlers →
    // bus → agent) with zero network.
    const inbox = process.env.OFFICEOS_MOCK_INBOX;
    if (!inbox || !existsSync(inbox)) return;
    for (const line of readFileSync(inbox, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as IncomingMessage;
      if (msg.text?.match(/^(allow|deny)\b/i) && msg.senderRole === 'owner') {
        const [, decision, shortId] = msg.text.match(/^(allow|deny)(?:\s+(\S+))?/i)!;
        handlers.onApproval(decision.toLowerCase() as 'allow' | 'deny', shortId, msg.senderRole);
      } else {
        await handlers.onMessage(msg);
      }
    }
  }

  async stop(): Promise<void> {
    /* no-op */
  }

  private record(entry: Record<string, unknown>): void {
    const outbox = process.env.OFFICEOS_MOCK_OUTBOX;
    if (!outbox) return;
    try {
      appendFileSync(outbox, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      /* best-effort — tests that care set a writable path */
    }
  }
}
