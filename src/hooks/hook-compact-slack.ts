import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

async function main(): Promise<void> {
  const agentName = process.env.CTX_AGENT_NAME || 'agent';
  const agentDir = process.env.CTX_AGENT_DIR || '';

  let botToken = '';
  let channelId = '';
  const envFile = join(agentDir, '.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    botToken = content.match(/^SLACK_BOT_TOKEN=(.+)$/m)?.[1]?.trim() || '';
    channelId = content.match(/^SLACK_CHANNEL_ID=(.+)$/m)?.[1]?.trim() || '';
  }
  if (!botToken) botToken = process.env.SLACK_BOT_TOKEN || '';
  if (!channelId) channelId = process.env.SLACK_CHANNEL_ID || '';

  if (!botToken || !channelId) return;

  const message = `[Context] *${agentName}* is compacting context (context window near limit).`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, text: message }),
      signal: controller.signal,
    });
  } catch {
    // Non-fatal, non-blocking
  } finally {
    clearTimeout(timer);
  }
}

main().catch(() => process.exit(0));
