import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Capture the handlers SlackAdapter registers on the socket so the test can
// fire inbound events through the real gate logic.
let messageHandler: ((event: any) => Promise<void> | void) | undefined;
vi.mock('../../../src/slack/socket-client.js', () => ({
  SlackSocketClient: class {
    constructor(_t: string) {}
    onMessage(h: any) { messageHandler = h; }
    onEvent(_t: string, _h: any) {}
    start() { return Promise.resolve(); }
    stop() { return Promise.resolve(); }
  },
}));
// Avoid any real Slack client construction / network.
vi.mock('../../../src/slack/api.js', () => ({
  SlackAPI: class {
    constructor(_t: string) {}
    getBotUserId() { return Promise.resolve('UBOT'); }
    getThreadReplies() { return Promise.resolve([]); }
  },
}));

import { SlackAdapter, type SlackInboundConfig } from '../../../src/channels/slack/slack-adapter.js';

function makeConfig(over: Partial<SlackInboundConfig>, stateDir: string): SlackInboundConfig {
  return {
    appToken: 'xapp-1',
    ownerId: 'UOWNER',
    allowedChannels: new Set(['CALLOWED']),
    readonlyIds: new Set<string>(),
    allowedDomains: new Set<string>(),
    rateLimitSpec: '10/60',
    stateDir,
    ...over,
  };
}

interface Captured { messages: any[]; approvals: any[] }
function handlers(): { h: any; c: Captured } {
  const c: Captured = { messages: [], approvals: [] };
  return {
    c,
    h: {
      onMessage: (m: any) => { c.messages.push(m); },
      onApproval: (decision: string, shortId: string | undefined, role: string) => { c.approvals.push({ decision, shortId, role }); },
    },
  };
}

async function fire(event: Partial<any>) {
  await messageHandler!({ type: 'message', channel: 'CALLOWED', channel_type: 'channel', ts: '1700.1', ...event });
}

describe('SlackAdapter inbound gates', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'slack-inbound-'));
    messageHandler = undefined;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('owner message is injected with OWNER tag', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({}, dir)).start(h);
    await fire({ user: 'UOWNER', text: 'what shipped overnight?' });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].senderRole).toBe('owner');
    expect(c.messages[0].injection).toContain('[OWNER]');
    expect(c.messages[0].injection).toContain('what shipped overnight?');
  });

  it('drops unknown users (gate 1)', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({}, dir)).start(h);
    await fire({ user: 'USTRANGER', text: 'hi' });
    expect(c.messages).toHaveLength(0);
  });

  it('drops non-DM messages outside the channel allowlist (gate 2)', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({}, dir)).start(h);
    await fire({ user: 'UOWNER', text: 'hi', channel: 'COTHER' });
    expect(c.messages).toHaveLength(0);
  });

  it('owner approval routes to onApproval with shortId, not onMessage (gate 5)', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({}, dir)).start(h);
    await fire({ user: 'UOWNER', text: 'allow a1b2c3' });
    expect(c.messages).toHaveLength(0);
    expect(c.approvals).toEqual([{ decision: 'allow', shortId: 'a1b2c3', role: 'owner' }]);
  });

  it('readonly attempting approval is blocked (no inject, no approval)', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({ readonlyIds: new Set(['URO']) }, dir)).start(h);
    await fire({ user: 'URO', text: 'allow a1b2c3' });
    expect(c.messages).toHaveLength(0);
    expect(c.approvals).toHaveLength(0);
  });

  it('readonly message carries the READONLY preamble', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({ readonlyIds: new Set(['URO']) }, dir)).start(h);
    await fire({ user: 'URO', text: 'status?' });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0].senderRole).toBe('readonly');
    expect(c.messages[0].injection).toContain('READONLY USER');
  });

  it('rate-limits readonly users (gate 4)', async () => {
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({ readonlyIds: new Set(['URO']), rateLimitSpec: '1/60' }, dir)).start(h);
    await fire({ user: 'URO', text: 'one' });
    await fire({ user: 'URO', text: 'two' });
    expect(c.messages).toHaveLength(1); // second dropped
  });

  it('enforces the email domain allowlist (gate 3)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const isEvil = url.includes('UEVIL');
      return { json: async () => ({ user: { profile: { email: isEvil ? 'x@evil.com' : 'x@acme.com' } } }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { h, c } = handlers();
    await new SlackAdapter('xoxb', makeConfig({
      readonlyIds: new Set(['UEVIL', 'UGOOD']),
      allowedDomains: new Set(['acme.com']),
    }, dir)).start(h);
    await fire({ user: 'UEVIL', text: 'hi' });
    await fire({ user: 'UGOOD', text: 'hi' });
    expect(c.messages.map((m) => m.senderId)).toEqual(['UGOOD']);
  });

  it('persists slack-thread.json for hook reply targeting', async () => {
    const { h } = handlers();
    await new SlackAdapter('xoxb', makeConfig({}, dir)).start(h);
    await fire({ user: 'UOWNER', text: 'hi', channel: 'CALLOWED', ts: '1700.9' });
    const { readFileSync } = await import('fs');
    const persisted = JSON.parse(readFileSync(join(dir, 'slack-thread.json'), 'utf-8'));
    expect(persisted).toMatchObject({ channel: 'CALLOWED', msgTs: '1700.9' });
  });
});
