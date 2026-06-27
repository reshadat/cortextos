/**
 * Daemon-enforced correlation — the request_id(s) the agent is processing THIS
 * turn, written by the daemon at inject time so outbound bus/reply commands
 * never depend on the LLM hand-typing the id.
 *
 * The agent (an LLM) copies `[req:<id>]` from the injection header into its
 * `bus send-message`/`send-slack` commands. In practice it reuses stale ids
 * across different questions and drops characters when retyping them, which
 * mis-routes or silently drops replies under concurrent users. The daemon, by
 * contrast, knows exactly which message(s) it just injected. resolveRequestId()
 * uses that as the source of truth: a typed id is honoured only if it actually
 * belongs to the current turn (disambiguation in a fan-out); otherwise the
 * daemon's sole current id wins, immune to reuse and corruption.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '../utils/atomic.js';
import { getTarget } from './reply-targets.js';

const FILE = 'current-request.json';
const TTL_MS = 10 * 60 * 1000; // 10 min — a turn's reply should land well within this

interface CurrentRequest {
  request_ids: string[];
  ts: number;
}

/** Record the request_id(s) being injected this turn (deduped, empties dropped). */
export function writeCurrentRequest(stateDir: string, requestIds: Array<string | undefined>, nowMs: number = Date.now()): void {
  const ids = [...new Set(requestIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  atomicWriteSync(join(stateDir, FILE), JSON.stringify({ request_ids: ids, ts: nowMs }));
}

/** The request_id(s) of the current turn (empty if none/expired). */
export function readCurrentRequest(stateDir: string, nowMs: number = Date.now()): string[] {
  const p = join(stateDir, FILE);
  if (!existsSync(p)) return [];
  try {
    const c = JSON.parse(readFileSync(p, 'utf-8')) as CurrentRequest;
    if (!c || !Array.isArray(c.request_ids) || nowMs - c.ts >= TTL_MS) return [];
    return c.request_ids;
  } catch {
    return [];
  }
}

/**
 * The effective request_id for an outbound command. Daemon-enforced:
 *  - a typed id that belongs to THIS turn is honoured (fan-out disambiguation);
 *  - else if the turn has exactly one request, that one wins (reuse/corruption-
 *    proof — a stale or character-dropped typed id is ignored);
 *  - else fall back to a typed id that is at least a real stored target;
 *  - else whatever was typed (last resort; may be undefined).
 */
export function resolveRequestId(stateDir: string, typed: string | undefined, nowMs: number = Date.now()): string | undefined {
  const current = readCurrentRequest(stateDir, nowMs);
  if (typed && current.includes(typed)) return typed;
  if (current.length === 1) return current[0];
  if (typed && getTarget(stateDir, typed, nowMs)) return typed;
  return typed ?? current[0];
}
