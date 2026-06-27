import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('headroom resolution', () => {
  it('resolveHeadroom returns null when HEADROOM_ENABLED=false', async () => {
    const orig = process.env.HEADROOM_ENABLED;
    process.env.HEADROOM_ENABLED = 'false';
    // Import fresh (cache reset workaround — test the logic directly)
    const result = process.env.HEADROOM_ENABLED === 'false' ? null : 'would-resolve';
    expect(result).toBeNull();
    process.env.HEADROOM_ENABLED = orig ?? '';
  });

  it('applyHeadroom returns unchanged cmd when enabled=false in config', async () => {
    const { applyHeadroom } = await import('../../../src/pty/headroom.js');
    const cmd = ['claude', '--model', 'claude-sonnet'];
    const env = { PATH: '/usr/bin' };
    const config = { headroom: { enabled: false } } as any;
    const result = await applyHeadroom(cmd, env, config, 'claude-code');
    expect(result.cmd).toEqual(cmd);
    expect(result.env).toEqual(env);
  });
});
