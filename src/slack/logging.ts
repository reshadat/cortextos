import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export function logOutboundSlackMessage(
  ctxRoot: string,
  agentName: string,
  channelId: string,
  text: string,
  ts: string,
): void {
  const stateDir = join(ctxRoot, 'state', agentName);
  mkdirSync(stateDir, { recursive: true });
  const logFile = join(stateDir, 'outbound-messages.jsonl');
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    channel_id: channelId,
    slack_ts: ts,
    text,
    platform: 'slack',
  });
  appendFileSync(logFile, entry + '\n', 'utf-8');
}

export function cacheLastSentSlack(ctxRoot: string, agentName: string, channelId: string, text: string): void {
  const stateDir = join(ctxRoot, 'state', agentName);
  mkdirSync(stateDir, { recursive: true });
  const cacheFile = join(stateDir, 'last-sent-slack.json');
  writeFileSync(cacheFile, JSON.stringify({ channelId, text, ts: new Date().toISOString() }), 'utf-8');
}

export function buildRecentSlackHistory(ctxRoot: string, agentName: string): string {
  const logFile = join(ctxRoot, 'state', agentName, 'outbound-messages.jsonl');
  if (!existsSync(logFile)) return '';
  try {
    const lines = readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-5).map((l) => {
      const parsed = JSON.parse(l);
      return `[${parsed.ts}] agent: ${(parsed.text || '').slice(0, 200)}`;
    });
    return recent.join('\n');
  } catch {
    return '';
  }
}
