import { describe, it, expect } from 'vitest';
import { selectRequestTurn, type PendingItem } from '../../../src/daemon/turn-selector.js';

const item = (requestId: string | undefined, formatted: string): PendingItem => ({ requestId, formatted, ref: formatted });

describe('selectRequestTurn (per-request serialization)', () => {
  it('returns null for an empty list', () => {
    expect(selectRequestTurn([])).toBeNull();
  });

  it('selects only the oldest request, defers the rest', () => {
    const turn = selectRequestTurn([
      item('rA', 'a1'), item('rB', 'b1'), item('rA', 'a2'),
    ])!;
    expect(turn.block).toBe('a1a2');
    expect(turn.requestIds).toEqual(['rA', 'rA']);
    expect(turn.deferred.map((d) => d.formatted)).toEqual(['b1']);
  });

  it('groups undefined-request items together (e.g. a no-req channel)', () => {
    const turn = selectRequestTurn([item(undefined, 't1'), item(undefined, 't2'), item('rB', 'b1')])!;
    expect(turn.block).toBe('t1t2');
    expect(turn.deferred.map((d) => d.formatted)).toEqual(['b1']);
  });

  it('a single request yields a singular current-request', () => {
    const turn = selectRequestTurn([item('only', 'x')])!;
    expect(turn.requestIds).toEqual(['only']);
    expect(turn.deferred).toEqual([]);
  });
});
