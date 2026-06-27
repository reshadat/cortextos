import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sendToReplyTarget } from '../../../src/channels/send.js';
import { recordTarget } from '../../../src/channels/reply-targets.js';

describe('sendToReplyTarget — hooks reply to the OWNER channel', () => {
  let agentDir: string;
  let stateDir: string;
  let outbox: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'send-agent-'));
    stateDir = mkdtempSync(join(tmpdir(), 'send-state-'));
    outbox = join(stateDir, 'outbox.jsonl');
    for (const k of ['OFFICEOS_CHANNEL_ADAPTER', 'OFFICEOS_MOCK_OUTBOX', 'OFFICEOS_MOCK_NO_TARGET', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_ALLOWED_CHANNELS']) saved[k] = process.env[k];
    process.env.OFFICEOS_CHANNEL_ADAPTER = 'mock';
    process.env.OFFICEOS_MOCK_OUTBOX = outbox;
    delete process.env.OFFICEOS_MOCK_NO_TARGET;
    for (const k of ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'SLACK_ALLOWED_CHANNELS']) delete process.env[k];
  });

  afterEach(() => {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  const writeEnv = (body: string) => writeFileSync(join(agentDir, '.env'), body);
  const writeThread = (channel: string, threadTs: string, role: 'owner' | 'readonly' = 'owner') =>
    recordTarget(stateDir, `req-${channel}`, { conversationId: channel, threadId: threadTs, role });
  const lastSend = () => JSON.parse(readFileSync(outbox, 'utf-8').trim().split('\n').pop()!);

  it('sends to SLACK_CHANNEL_ID', async () => {
    writeEnv('SLACK_BOT_TOKEN=xoxb-1\nSLACK_CHANNEL_ID=C_OWNER\n');
    const res = await sendToReplyTarget(agentDir, stateDir, 'hello');
    expect(res).toEqual({ messageId: 'mock-ts-1' });
    expect(lastSend()).toMatchObject({ text: 'hello', target: { conversationId: 'C_OWNER' } });
  });

  it('falls back to the first SLACK_ALLOWED_CHANNELS entry when no single channel', async () => {
    writeEnv('SLACK_BOT_TOKEN=xoxb-1\nSLACK_ALLOWED_CHANNELS=C_FIRST,C_SECOND\n');
    await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(lastSend().target.conversationId).toBe('C_FIRST');
  });

  it('posts UNTHREADED to the owner channel — never into a conversation thread', async () => {
    // A hook prompt has no reliable request_id; it must land top-level in the
    // owner channel, never threaded (even into an owner thread), to avoid the
    // wrong-thread class entirely.
    writeEnv('SLACK_BOT_TOKEN=xoxb-1\nSLACK_CHANNEL_ID=C_OWNER\n');
    writeThread('C_OWNER', '1700.5');
    await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(lastSend().target).toEqual({ conversationId: 'C_OWNER', threadId: undefined });
  });

  it('does NOT thread into a readonly user\'s channel — posts to owner channel untreaded', async () => {
    // Regression: the last inbound was a readonly user in a different channel.
    // The hook prompt must still land in the OWNER channel, not the readonly thread.
    writeEnv('SLACK_BOT_TOKEN=xoxb-1\nSLACK_CHANNEL_ID=C_OWNER\n');
    writeThread('C_READONLY', '1700.9', 'readonly');
    await sendToReplyTarget(agentDir, stateDir, 'permission?');
    expect(lastSend().target).toEqual({ conversationId: 'C_OWNER', threadId: undefined });
  });

  it('returns null and sends nothing without a bot token', async () => {
    writeEnv('# no slack token\nSLACK_CHANNEL_ID=C_OWNER\n');
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toBeNull();
    expect(existsSync(outbox)).toBe(false);
  });

  it('returns null when no owner channel is configured at all', async () => {
    writeEnv('SLACK_BOT_TOKEN=xoxb-1\n');
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toBeNull();
    expect(existsSync(outbox)).toBe(false);
  });

  it('reads a BOM-prefixed .env (Windows)', async () => {
    writeEnv('﻿SLACK_BOT_TOKEN=xoxb-1\nSLACK_CHANNEL_ID=C_OWNER\n');
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toEqual({ messageId: 'mock-ts-1' });
    expect(lastSend().target.conversationId).toBe('C_OWNER');
  });
});
