import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { recordTarget } from '../../../src/channels/reply-targets.js';

// Control SlackAPI behavior without touching the network.
const getBotUserId = vi.fn();
const sendMessage = vi.fn();
const addReaction = vi.fn();
vi.mock('../../../src/slack/api.js', () => ({
  SlackAPI: class {
    constructor(_token: string) {}
    getBotUserId = getBotUserId;
    sendMessage = sendMessage;
    addReaction = addReaction;
  },
}));

import { SlackAdapter } from '../../../src/channels/slack/slack-adapter.js';

describe('SlackAdapter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'slack-adapter-'));
    getBotUserId.mockReset();
    sendMessage.mockReset();
    addReaction.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('validateCredentials ok when auth.test yields a bot id', async () => {
    getBotUserId.mockResolvedValue('UBOT123');
    const res = await new SlackAdapter('xoxb-x').validateCredentials();
    expect(res).toEqual({ ok: true, identity: 'UBOT123' });
  });

  it('validateCredentials fails when auth.test yields no id', async () => {
    getBotUserId.mockResolvedValue(null);
    const res = await new SlackAdapter('xoxb-x').validateCredentials();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no user id/);
  });

  it('validateCredentials surfaces thrown errors', async () => {
    getBotUserId.mockRejectedValue(new Error('invalid_auth'));
    const res = await new SlackAdapter('xoxb-x').validateCredentials();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid_auth/);
  });

  it('sendMessage maps SlackAPI result to messageId', async () => {
    sendMessage.mockResolvedValue({ ts: '1700.001', channel: 'C1' });
    const res = await new SlackAdapter('xoxb-x').sendMessage({ conversationId: 'C1', threadId: 'T1' }, 'hi');
    expect(res).toEqual({ messageId: '1700.001' });
    expect(sendMessage).toHaveBeenCalledWith('C1', 'hi', 'T1');
  });

  it('sendMessage returns null when SlackAPI returns null', async () => {
    sendMessage.mockResolvedValue(null);
    const res = await new SlackAdapter('xoxb-x').sendMessage({ conversationId: 'C1' }, 'hi');
    expect(res).toBeNull();
  });

  it('resolveReplyTarget reads the per-request store (by id and most-recent)', () => {
    recordTarget(dir, 'req-9', { conversationId: 'C9', threadId: '1700.5' });
    const a = new SlackAdapter('xoxb-x');
    expect(a.resolveReplyTarget(dir, 'req-9')).toEqual({ conversationId: 'C9', threadId: '1700.5' });
    expect(a.resolveReplyTarget(dir)).toEqual({ conversationId: 'C9', threadId: '1700.5' }); // most recent
  });

  it('resolveReplyTarget returns null when no target recorded', () => {
    expect(new SlackAdapter('xoxb-x').resolveReplyTarget(dir)).toBeNull();
    expect(new SlackAdapter('xoxb-x').resolveReplyTarget(dir, 'nope')).toBeNull();
  });

  it('start throws when constructed outbound-only (no inbound config)', async () => {
    await expect(new SlackAdapter('xoxb-x').start({ onMessage: () => {}, onApproval: () => {} }))
      .rejects.toThrow(/no inbound config/);
  });
});
