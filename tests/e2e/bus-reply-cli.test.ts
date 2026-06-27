/**
 * Black-box E2E for the adapter-agnostic `bus reply` / `bus react` commands.
 *
 * Spawns the real dist/cli.js with the MockAdapter (OFFICEOS_CHANNEL_ADAPTER=mock)
 * and asserts on the JSONL outbox — the genuine path an agent's reply takes:
 * detect the agent's channel, resolve the current request, route to its stored
 * conversation. No network, no live Slack, no hand-typed channel or id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { recordTarget } from '../../src/channels/reply-targets.js';
import { writeCurrentRequest } from '../../src/channels/current-request.js';

const repoRoot = join(__dirname, '..', '..');
const cli = join(repoRoot, 'dist', 'cli.js');
const distPresent = existsSync(cli);

describe.skipIf(!distPresent)('bus reply/react — black-box CLI E2E (mock adapter)', () => {
  let ctxRoot: string;
  let agentDir: string;
  let stateDir: string;
  let outbox: string;

  beforeEach(() => {
    ctxRoot = mkdtempSync(join(tmpdir(), 'bus-reply-'));
    agentDir = join(ctxRoot, 'orgs', 'docs', 'agents', 'docs-orch');
    stateDir = join(ctxRoot, 'state', 'docs-orch');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    // Slack-configured agent (token is never used — mock adapter swaps it out).
    writeFileSync(join(agentDir, '.env'), 'SLACK_BOT_TOKEN=xoxb-test\nSLACK_APP_TOKEN=xapp-test\nSLACK_CHANNEL_ID=C_OWNER\n');
    outbox = join(ctxRoot, 'outbox.jsonl');
  });
  afterEach(() => rmSync(ctxRoot, { recursive: true, force: true }));

  function run(args: string[]) {
    return spawnSync(process.execPath, [cli, 'bus', ...args], {
      env: {
        ...process.env,
        CTX_ROOT: ctxRoot,
        CTX_AGENT_NAME: 'docs-orch',
        CTX_AGENT_DIR: agentDir,
        CTX_ORG: 'docs',
        OFFICEOS_CHANNEL_ADAPTER: 'mock',
        OFFICEOS_MOCK_OUTBOX: outbox,
      },
      encoding: 'utf-8',
    });
  }
  const outboxOps = () => readFileSync(outbox, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it('reply routes to the current request\'s conversation — no channel or id typed', () => {
    recordTarget(stateDir, 'rNow', { conversationId: 'C_ALICE', threadId: 'TA', role: 'owner' });
    writeCurrentRequest(stateDir, ['rNow']);

    const res = run(['reply', 'here is your answer']);
    expect(res.status, res.stderr).toBe(0);
    const ops = outboxOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'sendMessage', text: 'here is your answer', target: { conversationId: 'C_ALICE', threadId: 'TA' } });
  });

  it('reply ignores a reused/corrupted typed id and uses the current request', () => {
    recordTarget(stateDir, 'rStale', { conversationId: 'C_OLD', threadId: 'T_OLD', role: 'owner' });
    recordTarget(stateDir, 'rNow', { conversationId: 'C_NEW', threadId: 'T_NEW', role: 'owner' });
    writeCurrentRequest(stateDir, ['rNow']);

    const res = run(['reply', 'corrected', '--request-id', 'rStale']);
    expect(res.status, res.stderr).toBe(0);
    expect(outboxOps()[0].target).toMatchObject({ conversationId: 'C_NEW', threadId: 'T_NEW' });
  });

  it('react adds a reaction on the current request\'s message', () => {
    recordTarget(stateDir, 'rNow', { conversationId: 'C_ALICE', threadId: 'TA', messageId: '1700.1', role: 'owner' });
    writeCurrentRequest(stateDir, ['rNow']);

    const res = run(['react', 'eyes']);
    expect(res.status, res.stderr).toBe(0);
    expect(outboxOps()[0]).toMatchObject({ op: 'addReaction', messageId: '1700.1', emoji: 'eyes' });
  });
});
