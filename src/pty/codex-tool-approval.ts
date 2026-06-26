/**
 * Daemon-level turn approval for Codex app-server runtime.
 *
 * Codex has no Claude Code hook protocol. This module provides parity by
 * adding turn-level approval before messages are sent to Codex. Write a
 * pending file → Python watcher detects it → sends Slack notification →
 * waits for "allow"/"deny" reply → writes response file → PTY resumes.
 *
 * NOTE: True per-tool interception requires Codex approvalPolicy != 'never'
 * and handling the approval RPC event from Codex. V1 provides turn-level
 * approval (approve the whole message before Codex executes it). Per-tool
 * approval is a follow-up requiring Codex API investigation.
 */

import { join } from 'path';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';

function generateId(): string {
  return randomBytes(16).toString('hex');
}

export function writeTurnApprovalPending(
  stateDir: string,
  agentName: string,
  channelId: string,
  turnText: string,
): { approvalId: string; pendingFile: string; responseFile: string } {
  mkdirSync(stateDir, { recursive: true });
  const approvalId = generateId();
  const pendingFile = join(stateDir, `tool-approval-${approvalId}.pending`);
  const responseFile = join(stateDir, `tool-approval-${approvalId}.json`);

  writeFileSync(pendingFile, JSON.stringify({
    approvalId,
    agentName,
    channelId,
    type: 'codex-turn',
    turnPreview: turnText.slice(0, 500),
    createdAt: new Date().toISOString(),
  }), 'utf-8');

  return { approvalId, pendingFile, responseFile };
}

export async function waitForTurnApproval(
  responseFile: string,
  pendingFile: string,
  timeoutMs = 30 * 60 * 1000,
): Promise<'allow' | 'deny'> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(responseFile)) {
      try {
        const content = require('fs').readFileSync(responseFile, 'utf-8');
        const parsed = JSON.parse(content);
        const decision = parsed.decision === 'allow' ? 'allow' : 'deny';
        try { unlinkSync(responseFile); } catch {}
        try { unlinkSync(pendingFile); } catch {}
        return decision;
      } catch {
        // File mid-write, retry
      }
    }
    await new Promise<void>((res) => setTimeout(res, 2000));
  }

  try { unlinkSync(pendingFile); } catch {}
  return 'deny';
}
