import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readSlackInboundConfig } from '../../../src/channels/slack/slack-adapter.js';
import { resolveAdapter } from '../../../src/channels/registry.js';
import { SlackAdapter } from '../../../src/channels/slack/slack-adapter.js';

describe('readSlackInboundConfig', () => {
  let dir: string;
  const writeEnv = (body: string) => writeFileSync(join(dir, '.env'), body);

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'slack-cfg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when the agent has no Slack tokens', () => {
    writeEnv('BOT_TOKEN=telegram-only\n');
    expect(readSlackInboundConfig(dir, join(dir, 'state'))).toBeNull();
  });

  it('returns null when there is no .env at all', () => {
    expect(readSlackInboundConfig(dir, join(dir, 'state'))).toBeNull();
  });

  it('parses all gate fields from the env', () => {
    writeEnv([
      'SLACK_BOT_TOKEN=xoxb-1',
      'SLACK_APP_TOKEN=xapp-1',
      'SLACK_USER_ID=UOWNER',
      'SLACK_ALLOWED_CHANNELS=C1,C2',
      'SLACK_READONLY_USERS=R1, R2',
      'SLACK_ALLOWED_DOMAINS=Acme.com, EVIL.com',
      'SLACK_READONLY_RATE_LIMIT=3/30',
    ].join('\n'));
    const parsed = readSlackInboundConfig(dir, '/state');
    expect(parsed).not.toBeNull();
    expect(parsed!.botToken).toBe('xoxb-1');
    expect(parsed!.config.ownerId).toBe('UOWNER');
    expect([...parsed!.config.allowedChannels]).toEqual(['C1', 'C2']);
    expect([...parsed!.config.readonlyIds]).toEqual(['R1', 'R2']);
    expect([...parsed!.config.allowedDomains]).toEqual(['acme.com', 'evil.com']); // lowercased
    expect(parsed!.config.rateLimitSpec).toBe('3/30');
    expect(parsed!.config.stateDir).toBe('/state');
  });

  it('prefers SLACK_ALLOWED_CHANNELS over SLACK_CHANNEL_ID', () => {
    writeEnv('SLACK_BOT_TOKEN=b\nSLACK_APP_TOKEN=a\nSLACK_CHANNEL_ID=CSINGLE\nSLACK_ALLOWED_CHANNELS=CM1,CM2\n');
    const parsed = readSlackInboundConfig(dir, '/state');
    expect([...parsed!.config.allowedChannels]).toEqual(['CM1', 'CM2']);
  });

  it('falls back to SLACK_CHANNEL_ID when no multi-channel set', () => {
    writeEnv('SLACK_BOT_TOKEN=b\nSLACK_APP_TOKEN=a\nSLACK_CHANNEL_ID=CSINGLE\n');
    const parsed = readSlackInboundConfig(dir, '/state');
    expect([...parsed!.config.allowedChannels]).toEqual(['CSINGLE']);
    expect(parsed!.config.rateLimitSpec).toBe('10/60'); // default
  });
});

describe('resolveAdapter inbound path', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'slack-resolve-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('builds a SlackAdapter for an inbound-capable agent', () => {
    writeFileSync(join(dir, '.env'), 'SLACK_BOT_TOKEN=b\nSLACK_APP_TOKEN=a\nSLACK_USER_ID=U\n');
    const a = resolveAdapter('slack', { agentDir: dir, stateDir: join(dir, 'state'), forInbound: true });
    expect(a).toBeInstanceOf(SlackAdapter);
  });

  it('returns null for a non-Slack agent on the inbound path', () => {
    writeFileSync(join(dir, '.env'), 'BOT_TOKEN=telegram\n');
    const a = resolveAdapter('slack', { agentDir: dir, stateDir: join(dir, 'state'), forInbound: true });
    expect(a).toBeNull();
  });
});
