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
import { mostRecentTargetForRole } from './reply-targets.js';
import { stripBom } from '../utils/strip-bom.js';

/** Read one key out of an agent's .env (BOM-safe), falling back to process.env. */
function readEnvKey(agentDir: string, key: string): string {
  const envFile = join(agentDir, '.env');
  if (existsSync(envFile)) {
    const m = stripBom(readFileSync(envFile, 'utf-8')).match(new RegExp(`^${key}=(.+)$`, 'm'));
    if (m) return m[1].trim();
  }
  return process.env[key]?.trim() || '';
}

/** The agent's owner-facing channel: single SLACK_CHANNEL_ID, else first of SLACK_ALLOWED_CHANNELS. */
function ownerChannel(agentDir: string): string {
  const single = readEnvKey(agentDir, 'SLACK_CHANNEL_ID');
  if (single) return single;
  return readEnvKey(agentDir, 'SLACK_ALLOWED_CHANNELS')
    .split(',').map((s) => s.trim()).filter(Boolean)[0] || '';
}

/**
 * Send `text` to the agent's OWNER channel — these are agent→owner hook
 * notifications (permission/plan/ask/compact/crash), so they must land where the
 * owner watches, never in a readonly user's channel/thread. We thread the reply
 * only when the last inbound message was in that same owner channel. Returns
 * null (caller skips) when no owner channel is configured.
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

  const channel = ownerChannel(agentDir);
  if (!channel) return null;

  // Thread only off the latest OWNER message in the owner channel — never a
  // readonly user's thread (a hook prompt is an owner-facing notification).
  const lastOwner = mostRecentTargetForRole(stateDir, 'owner');
  const threadId = lastOwner && lastOwner.conversationId === channel ? lastOwner.threadId : undefined;

  return adapter.sendMessage({ conversationId: channel, threadId }, text);
}
