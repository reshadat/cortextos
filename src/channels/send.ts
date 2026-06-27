/**
 * Shared Slack outbound — the single send path for the Slack hooks (and any
 * caller that replies to "wherever the last inbound message came from").
 *
 * Resolves the adapter through the registry, so OFFICEOS_CHANNEL_ADAPTER=mock
 * routes hook sends to the MockAdapter with zero network — that's how the hook
 * outbound becomes testable.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveAdapter } from './registry.js';
import type { OutboundTarget } from './adapter.js';

/** Read one key out of an agent's .env, falling back to process.env. */
function readEnvKey(agentDir: string, key: string): string {
  const envFile = join(agentDir, '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf-8').match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (m) return m[1].trim();
  }
  return process.env[key]?.trim() || '';
}

/**
 * Send `text` to the agent's current Slack reply target (the channel/thread of
 * the last inbound message, from slack-thread.json), falling back to the
 * configured SLACK_CHANNEL_ID. Returns null when no target is known (caller
 * skips — same as the old hooks did when there was no thread state).
 */
export async function sendToReplyTarget(
  agentDir: string,
  stateDir: string,
  text: string,
): Promise<{ messageId: string } | null> {
  const botToken = readEnvKey(agentDir, 'SLACK_BOT_TOKEN');
  if (!botToken) return null;

  const adapter = resolveAdapter('slack', { botToken, agentDir, stateDir });
  if (!adapter) return null;

  let target: OutboundTarget | null = adapter.resolveReplyTarget(stateDir);
  if (!target) {
    const channel = readEnvKey(agentDir, 'SLACK_CHANNEL_ID');
    if (!channel) return null;
    target = { conversationId: channel };
  }
  return adapter.sendMessage(target, text);
}
