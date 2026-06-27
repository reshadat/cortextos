import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeChannelHandlers, writeApprovalResponse, type ChannelInjector } from '../../../src/daemon/channel-core.js';
import type { IncomingMessage } from '../../../src/channels/adapter.js';

function fakeInjector() {
  const queued: string[] = [];
  const seen = new Set<string>();
  const injector: ChannelInjector = {
    queueSlackMessage: (f) => { queued.push(f); },
    isDuplicate: (t) => { if (seen.has(t)) return true; seen.add(t); return false; },
  };
  return { injector, queued };
}

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  kind: 'slack', senderId: 'U1', senderRole: 'owner', text: 'hi',
  conversationId: 'C1', messageId: '1', injection: 'INJECT-1', raw: {}, ...over,
});

describe('channel-core handlers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'channel-core-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('queues the rendered injection', () => {
    const { injector, queued } = fakeInjector();
    makeChannelHandlers(injector, dir, () => {}).onMessage(msg());
    expect(queued).toEqual(['INJECT-1']);
  });

  it('dedups duplicate injections', () => {
    const { injector, queued } = fakeInjector();
    const h = makeChannelHandlers(injector, dir, () => {});
    h.onMessage(msg({ injection: 'DUP' }));
    h.onMessage(msg({ injection: 'DUP' }));
    expect(queued).toEqual(['DUP']);
  });

  it('ignores a message with no injection', () => {
    const { injector, queued } = fakeInjector();
    makeChannelHandlers(injector, dir, () => {}).onMessage(msg({ injection: undefined }));
    expect(queued).toHaveLength(0);
  });

  it('onApproval writes the decision to the matching pending file', () => {
    writeFileSync(join(dir, 'hook-response-abc123def.pending'), JSON.stringify({ uniqueId: 'abc123def' }));
    makeChannelHandlers(fakeInjector().injector, dir, () => {}).onApproval('allow', 'abc123', 'owner');
    expect(existsSync(join(dir, 'hook-response-abc123def.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'hook-response-abc123def.json'), 'utf-8')).decision).toBe('allow');
    // pending consumed
    expect(readdirSync(dir).some((f) => f.endsWith('.pending'))).toBe(false);
  });
});

describe('writeApprovalResponse', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'approval-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('shortId targets a specific pending request', () => {
    writeFileSync(join(dir, 'tool-approval-aaa111.pending'), JSON.stringify({ uniqueId: 'aaa111' }));
    writeFileSync(join(dir, 'tool-approval-bbb222.pending'), JSON.stringify({ uniqueId: 'bbb222' }));
    writeApprovalResponse(dir, 'deny', () => {}, 'bbb222');
    expect(existsSync(join(dir, 'tool-approval-bbb222.json'))).toBe(true);
    expect(existsSync(join(dir, 'tool-approval-aaa111.json'))).toBe(false);
  });

  it('no shortId falls back to latest-mtime', () => {
    writeFileSync(join(dir, 'hook-response-only1.pending'), JSON.stringify({ uniqueId: 'only1' }));
    writeApprovalResponse(dir, 'allow', () => {});
    expect(existsSync(join(dir, 'hook-response-only1.json'))).toBe(true);
  });

  it('no pending files is a safe no-op', () => {
    expect(() => writeApprovalResponse(dir, 'allow', () => {})).not.toThrow();
  });
});
