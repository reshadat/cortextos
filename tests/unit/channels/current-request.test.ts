import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeCurrentRequest, readCurrentRequest, resolveRequestId } from '../../../src/channels/current-request.js';
import { recordTarget } from '../../../src/channels/reply-targets.js';

describe('current-request (daemon-enforced correlation)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'curreq-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes and reads the turn request ids (deduped, empties dropped)', () => {
    writeCurrentRequest(dir, ['r1', undefined, 'r1', 'r2'], 1000);
    expect(readCurrentRequest(dir, 1001).sort()).toEqual(['r1', 'r2']);
  });

  it('expires past the TTL', () => {
    writeCurrentRequest(dir, ['r1'], 1000);
    expect(readCurrentRequest(dir, 1000 + 11 * 60 * 1000)).toEqual([]);
  });

  it('a stale/corrupted typed id is ignored — the sole current request wins', () => {
    // daemon stamped the real id for this turn
    writeCurrentRequest(dir, ['mqwtmq88-kgsoh'], 1000);
    // agent retyped it wrong (dropped a char) or reused an old one
    expect(resolveRequestId(dir, 'mqwtmq88-kgoh', 1001)).toBe('mqwtmq88-kgsoh');
    expect(resolveRequestId(dir, 'some-old-stale-id', 1001)).toBe('mqwtmq88-kgsoh');
    // and a missing id resolves to the current request too
    expect(resolveRequestId(dir, undefined, 1001)).toBe('mqwtmq88-kgsoh');
  });

  it('honours a typed id that actually belongs to this turn (fan-out disambiguation)', () => {
    writeCurrentRequest(dir, ['rA', 'rB'], 1000);
    expect(resolveRequestId(dir, 'rA', 1001)).toBe('rA');
    expect(resolveRequestId(dir, 'rB', 1001)).toBe('rB');
  });

  it('falls back to a valid stored target when the turn has multiple requests and the typed id is unknown', () => {
    recordTarget(dir, 'rValid', { conversationId: 'C1' }, 1000);
    writeCurrentRequest(dir, ['rA', 'rB'], 1000);
    // typed id is not in the turn but is a real target → honoured
    expect(resolveRequestId(dir, 'rValid', 1001)).toBe('rValid');
  });
});
