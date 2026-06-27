/**
 * Per-request reply targets — an adapter-framework concern, not Slack-specific.
 *
 * Replaces the single "last reply target" file that broke under concurrent
 * users. Every inbound message records its generic `OutboundTarget`
 * (conversationId + optional threadId) keyed by the message's `request_id`.
 * Outbound (agent reply, hook, bus gate) looks up the specific request's
 * target, or validates against the SET of recently-active conversations — so a
 * reply to user A is never blocked/misrouted because user B messaged a
 * different conversation a moment later.
 *
 * Channel-agnostic: a Slack adapter maps {channel, thread} → {conversationId,
 * threadId}; a future Telegram adapter maps {chat} → {conversationId}. The store
 * deals only in the generic target, so every channel inherits the correlation.
 *
 * One map file `reply-targets.json` per agent (atomic write, TTL + size pruned).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '../utils/atomic.js';
import type { OutboundTarget } from './adapter.js';

/** A recorded reply target — a generic OutboundTarget plus bookkeeping. */
export interface StoredTarget extends OutboundTarget {
  /** Native inbound message id (Slack ts), for reactions. */
  messageId?: string;
  /** Authorization role of the sender — so hook prompts target the OWNER, not a readonly thread. */
  role?: 'owner' | 'readonly' | 'unknown';
  /** Epoch ms when recorded (for TTL). */
  ts: number;
}

interface Store {
  targets: Record<string, StoredTarget>;
  /** Maps a thread anchor → the request_id that owns it, so a reply in an
   *  existing thread (e.g. answering an ASK_HUMAN) inherits the original id. */
  threads?: Record<string, string>;
}

const FILE = 'reply-targets.json';
const TTL_MS = 60 * 60 * 1000; // 60 min — generous; covers a slow human reply
const MAX = 50;

function load(stateDir: string): Store {
  const p = join(stateDir, FILE);
  if (!existsSync(p)) return { targets: {} };
  try {
    const s = JSON.parse(readFileSync(p, 'utf-8'));
    return s && typeof s === 'object' && s.targets ? (s as Store) : { targets: {} };
  } catch {
    return { targets: {} };
  }
}

function prune(store: Store, nowMs: number): Store {
  let entries = Object.entries(store.targets).filter(([, t]) => nowMs - t.ts < TTL_MS);
  entries.sort((a, b) => b[1].ts - a[1].ts);
  if (entries.length > MAX) entries = entries.slice(0, MAX);
  const targets = Object.fromEntries(entries);
  const liveIds = new Set(Object.keys(targets));
  const threads = Object.fromEntries(
    Object.entries(store.threads ?? {}).filter(([, reqId]) => liveIds.has(reqId)),
  );
  return { targets, threads };
}

/** Record (or refresh) the reply target for a request. `nowMs` is injectable for tests. */
export function recordTarget(
  stateDir: string,
  requestId: string,
  target: OutboundTarget & { messageId?: string; role?: 'owner' | 'readonly' | 'unknown' },
  nowMs: number = Date.now(),
): void {
  const store = prune(load(stateDir), nowMs);
  store.targets[requestId] = {
    conversationId: target.conversationId,
    threadId: target.threadId,
    messageId: target.messageId,
    role: target.role,
    ts: nowMs,
  };
  if (target.threadId) {
    store.threads = store.threads ?? {};
    // First writer of a thread owns it (don't let a later reply steal the id).
    if (!store.threads[target.threadId]) store.threads[target.threadId] = requestId;
  }
  atomicWriteSync(join(stateDir, FILE), JSON.stringify(store));
}

/** The request_id that owns a thread anchor, if any (and not expired). */
export function getRequestIdForThread(stateDir: string, threadId: string, nowMs: number = Date.now()): string | null {
  const store = prune(load(stateDir), nowMs);
  return store.threads?.[threadId] ?? null;
}

/** The most recent non-expired target for a given role (e.g. owner) — hook prompts use this. */
export function mostRecentTargetForRole(
  stateDir: string,
  role: 'owner' | 'readonly' | 'unknown',
  nowMs: number = Date.now(),
): StoredTarget | null {
  const entries = Object.values(prune(load(stateDir), nowMs).targets).filter((t) => t.role === role);
  if (!entries.length) return null;
  return entries.reduce((a, b) => (b.ts > a.ts ? b : a));
}

/** Look up a specific request's target (null if unknown or expired). */
export function getTarget(stateDir: string, requestId: string, nowMs: number = Date.now()): StoredTarget | null {
  const t = load(stateDir).targets[requestId];
  if (!t || nowMs - t.ts >= TTL_MS) return null;
  return t;
}

/** The most recently recorded (non-expired) target — used where no request id is available. */
export function mostRecentTarget(stateDir: string, nowMs: number = Date.now()): StoredTarget | null {
  const entries = Object.values(prune(load(stateDir), nowMs).targets);
  if (!entries.length) return null;
  return entries.reduce((a, b) => (b.ts > a.ts ? b : a));
}

/** The set of conversation ids with a recent active reply target (for the outbound gate). */
export function activeConversations(stateDir: string, nowMs: number = Date.now()): Set<string> {
  return new Set(Object.values(prune(load(stateDir), nowMs).targets).map((t) => t.conversationId));
}
