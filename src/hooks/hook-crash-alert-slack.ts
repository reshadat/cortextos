import { join } from 'path';
import { existsSync, statSync } from 'fs';
import { sendToReplyTarget } from '../channels/send.js';

function classifyEnd(stateDir: string): { emoji: string; label: string } {
  const nowMs = Date.now();
  const MARKER_WINDOW_MS = 60 * 1000;

  const markerRecent = (name: string) => {
    const p = join(stateDir, name);
    if (!existsSync(p)) return false;
    try { return (nowMs - statSync(p).mtimeMs) < MARKER_WINDOW_MS; } catch { return false; }
  };

  if (markerRecent('planned-restart.marker')) return { emoji: '🔄', label: 'planned restart' };
  if (markerRecent('session-refresh.marker')) return { emoji: '♻️', label: 'session refresh' };
  if (markerRecent('rate-limited.marker')) return { emoji: '⏳', label: 'rate limited' };
  if (markerRecent('max-turns.marker')) return { emoji: '🔁', label: 'max turns reached' };
  return { emoji: '🚨', label: 'CRASH' };
}

async function main(): Promise<void> {
  const agentName = process.env.CTX_AGENT_NAME || 'agent';
  const ctxRoot = process.env.CTX_ROOT || join(require('os').homedir(), '.officeos', 'default');
  const agentDir = process.env.CTX_AGENT_DIR || '';
  const stateDir = join(ctxRoot, 'state', agentName);

  const { emoji, label } = classifyEnd(stateDir);
  const message = `${emoji} *${agentName}* session ended: ${label}`;
  try {
    await sendToReplyTarget(agentDir, stateDir, message);
  } catch {
    // Non-fatal
  }
}

main().catch(() => process.exit(0));
