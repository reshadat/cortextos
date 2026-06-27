/**
 * channel-core — the channel-agnostic half of the inbound pipeline.
 *
 * A ChannelAdapter handles transport + authorization + rendering, then calls
 * these handlers. The core does only the plumbing every channel shares:
 *   - dedup + queue the rendered injection into the agent (via the FastChecker)
 *   - write the owner's approval decision to the pending-approval files
 *
 * writeApprovalResponse moved here from SlackControlPlane — it is not Slack
 * specific (the approval files are written by the channel-neutral hooks).
 */
import { join } from 'path';
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import type { InboundHandlers } from '../channels/adapter.js';

type LogFn = (msg: string) => void;

/** The slice of FastChecker the core needs to inject a message. */
export interface ChannelInjector {
  queueSlackMessage(formatted: string): void;
  isDuplicate(text: string): boolean;
}

/**
 * Resolve a pending approval and write the owner's decision.
 *
 * shortId: first 6 hex chars of the uniqueId from an `allow a1b2c3` message.
 * When given, matches the pending file whose uniqueId starts with shortId;
 * otherwise falls back to latest-mtime (legacy single-agent behaviour).
 */
export function writeApprovalResponse(
  stateDir: string,
  decision: 'allow' | 'deny',
  log: LogFn,
  shortId?: string,
): void {
  interface Candidate { path: string; mtime: number; prefix: string; uniqueId: string }
  const candidates: Candidate[] = [];

  for (const prefix of ['hook-response', 'tool-approval']) {
    try {
      const files = readdirSync(stateDir).filter(
        (f) => f.startsWith(prefix + '-') && f.endsWith('.pending'),
      );
      for (const f of files) {
        const p = join(stateDir, f);
        try {
          const meta = JSON.parse(readFileSync(p, 'utf-8'));
          const uniqueId = meta.uniqueId || meta.approvalId || '';
          candidates.push({ path: p, mtime: statSync(p).mtimeMs, prefix, uniqueId });
        } catch { /* corrupt pending file — skip */ }
      }
    } catch { /* stateDir may not exist yet */ }
  }

  if (candidates.length === 0) { log(`Channel: got "${decision}" but no pending approval files`); return; }

  let chosen: Candidate | null = null;
  if (shortId) {
    chosen = candidates.find((c) => c.uniqueId.startsWith(shortId)) ?? null;
    if (!chosen) { log(`Channel: no pending file matches shortId "${shortId}" — ignoring`); return; }
  } else {
    chosen = candidates.reduce((a, b) => (b.mtime > a.mtime ? b : a));
  }

  try {
    const responseFile = join(stateDir, `${chosen.prefix}-${chosen.uniqueId}.json`);
    writeFileSync(responseFile, JSON.stringify({ decision, ts: Date.now() }), 'utf-8');
    log(`Channel: approval written: ${decision} → ${chosen.prefix}-${chosen.uniqueId}.json`);
    try { unlinkSync(chosen.path); } catch { /* already gone */ }
  } catch (err: any) {
    log(`Channel: approval write error: ${err.message}`);
  }
}

/** Build the InboundHandlers an adapter calls — backed by a FastChecker + state dir. */
export function makeChannelHandlers(injector: ChannelInjector, stateDir: string, log: LogFn): InboundHandlers {
  return {
    onMessage(msg) {
      const formatted = msg.injection;
      if (!formatted) return;
      if (injector.isDuplicate(formatted)) return;
      injector.queueSlackMessage(formatted);
      log(`Channel: queued ${msg.kind} message from ${msg.senderId} [${msg.senderRole}]`);
    },
    onApproval(decision, shortId) {
      writeApprovalResponse(stateDir, decision, log, shortId);
    },
  };
}
