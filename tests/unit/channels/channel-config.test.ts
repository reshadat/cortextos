import { describe, it, expect } from 'vitest';
import { detectChannel, channelConfigHint, CHANNEL_SPECS } from '../../../src/channels/channel-config.js';

describe('channel-config (adapter-layer channel detection)', () => {
  it('detects Slack from SLACK_BOT_TOKEN', () => {
    const spec = detectChannel({ SLACK_BOT_TOKEN: 'xoxb-1', SLACK_APP_TOKEN: 'xapp-1', SLACK_CHANNEL_ID: 'C1' });
    expect(spec?.kind).toBe('slack');
    expect(spec?.requiredKeys).toEqual(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_CHANNEL_ID']);
  });

  it('detects Telegram from BOT_TOKEN/CHAT_ID', () => {
    expect(detectChannel({ BOT_TOKEN: '1:abc' })?.kind).toBe('telegram');
    expect(detectChannel({ CHAT_ID: '123' })?.kind).toBe('telegram');
  });

  it('returns null when no channel is configured (bus-only specialist)', () => {
    expect(detectChannel({ SOME_OTHER: 'x' })).toBeNull();
    expect(detectChannel({})).toBeNull();
  });

  it('prefers Slack when both are present (orchestrator with both)', () => {
    expect(detectChannel({ SLACK_BOT_TOKEN: 'xoxb', BOT_TOKEN: '1:abc' })?.kind).toBe('slack');
  });

  it('channelConfigHint lists every channel and its required keys', () => {
    const hint = channelConfigHint();
    expect(hint).toContain('slack');
    expect(hint).toContain('SLACK_BOT_TOKEN');
    expect(hint).toContain('telegram');
    expect(hint).toContain('BOT_TOKEN');
  });

  it('every spec exposes detect/requiredKeys/validate/adapter', () => {
    for (const spec of CHANNEL_SPECS) {
      expect(typeof spec.detect).toBe('function');
      expect(Array.isArray(spec.requiredKeys)).toBe(true);
      expect(typeof spec.validate).toBe('function');
      expect(typeof spec.adapter).toBe('function');
    }
  });

  it('telegram has no registry adapter yet (returns null, reported cleanly)', () => {
    const tg = CHANNEL_SPECS.find((s) => s.kind === 'telegram')!;
    expect(tg.adapter({ BOT_TOKEN: '1:abc', CHAT_ID: '1' })).toBeNull();
  });
});
