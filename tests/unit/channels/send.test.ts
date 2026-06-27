import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sendToReplyTarget } from '../../../src/channels/send.js';

describe('sendToReplyTarget', () => {
  let agentDir: string;
  let stateDir: string;
  let outbox: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), 'send-agent-'));
    stateDir = mkdtempSync(join(tmpdir(), 'send-state-'));
    outbox = join(stateDir, 'outbox.jsonl');
    for (const k of ['OFFICEOS_CHANNEL_ADAPTER', 'OFFICEOS_MOCK_OUTBOX', 'OFFICEOS_MOCK_NO_TARGET', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID']) saved[k] = process.env[k];
    process.env.OFFICEOS_CHANNEL_ADAPTER = 'mock';
    process.env.OFFICEOS_MOCK_OUTBOX = outbox;
    delete process.env.OFFICEOS_MOCK_NO_TARGET;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;
  });

  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  const lastSend = () => {
    const lines = readFileSync(outbox, 'utf-8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  };

  it('sends to the resolved reply target', async () => {
    writeFileSync(join(agentDir, '.env'), 'SLACK_BOT_TOKEN=xoxb-1\n');
    const res = await sendToReplyTarget(agentDir, stateDir, 'hello');
    expect(res).toEqual({ messageId: 'mock-ts-1' });
    expect(lastSend()).toMatchObject({ op: 'sendMessage', text: 'hello', target: { conversationId: 'C_MOCK' } });
  });

  it('reads the bot token from process.env when not in .env', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-env';
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toEqual({ messageId: 'mock-ts-1' });
  });

  it('returns null and sends nothing when no bot token is configured', async () => {
    writeFileSync(join(agentDir, '.env'), '# no slack token\n');
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toBeNull();
    expect(existsSync(outbox)).toBe(false);
  });

  it('falls back to SLACK_CHANNEL_ID when there is no reply target', async () => {
    writeFileSync(join(agentDir, '.env'), 'SLACK_BOT_TOKEN=xoxb-1\nSLACK_CHANNEL_ID=C_FALLBACK\n');
    process.env.OFFICEOS_MOCK_NO_TARGET = '1'; // force resolveReplyTarget → null
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toEqual({ messageId: 'mock-ts-1' });
    expect(lastSend()).toMatchObject({ target: { conversationId: 'C_FALLBACK' } });
  });

  it('returns null when no reply target and no SLACK_CHANNEL_ID', async () => {
    writeFileSync(join(agentDir, '.env'), 'SLACK_BOT_TOKEN=xoxb-1\n');
    process.env.OFFICEOS_MOCK_NO_TARGET = '1';
    const res = await sendToReplyTarget(agentDir, stateDir, 'hi');
    expect(res).toBeNull();
    expect(existsSync(outbox)).toBe(false);
  });
});
