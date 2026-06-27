/**
 * Black-box CLI E2E for `officeos onboard`.
 *
 * Spawns the real `dist/cli.js onboard` as a child process, drives its readline
 * prompts over stdin, and asserts on the files it produces — the genuine
 * end-to-end path a user walks, minus network and pm2.
 *
 * Slack is mocked by default via OFFICEOS_CHANNEL_ADAPTER=mock. A live variant
 * (OFFICEOS_E2E_LIVE_SLACK=1 + real tokens) hits api.slack.com instead.
 *
 * Isolation: a temp framework root with dist/ and templates/ symlinked in.
 * Node resolves node_modules from the symlink's realpath, so the symlinked
 * cli.js still finds the repo's real dependencies. orgs/ are written into the
 * temp root (real dir), never the repo.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import {
  mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, readFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const repoRoot = join(__dirname, '..', '..');
const realCli = join(repoRoot, 'dist', 'cli.js');
const distPresent = existsSync(realCli);

interface WizardResult { code: number | null; stdout: string; stderr: string; }
/** One scripted turn: wait for `expect` in stdout, then send `answer`. */
interface Step { expect: RegExp; answer: string }

/**
 * Drive the interactive wizard deterministically: send each answer only once
 * its prompt has actually appeared in stdout (matched past the last consumed
 * offset), never on a timer. This eliminates the race where a slow sub-command
 * (blocking spawnSync) would let a fixed delay fire before the prompt is shown.
 * A safety timeout rejects if an expected prompt never arrives.
 */
function driveWizard(tempRoot: string, tempHome: string, steps: Step[], extraEnv: Record<string, string> = {}): Promise<WizardResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: tempHome,
      CTX_FRAMEWORK_ROOT: tempRoot,
      CTX_PROJECT_ROOT: tempRoot,
      OFFICEOS_ONBOARD_SKIP_INSTALL: '1',
      OFFICEOS_ONBOARD_NO_START: '1',
      OFFICEOS_ONBOARD_SKIP_ENABLE: '1',
      OFFICEOS_CHANNEL_ADAPTER: 'mock',
      ...extraEnv,
    };
    const child = spawn(process.execPath, [join(tempRoot, 'dist', 'cli.js'), 'onboard', '--instance', 'e2e'], {
      cwd: tempRoot, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let consumed = 0;   // offset in stdout up to which prompts are answered
    let i = 0;          // current step

    const safety = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`wizard stalled waiting for step ${i} (${steps[i]?.expect}). stdout so far:\n${stdout}`));
    }, 45000);

    const pump = () => {
      while (i < steps.length) {
        const m = steps[i].expect.exec(stdout.slice(consumed));
        if (!m) return; // prompt not shown yet
        consumed += m.index + m[0].length;
        child.stdin.write(steps[i].answer + '\n');
        i++;
      }
      child.stdin.end(); // all answers sent
    };

    child.stdout.on('data', d => { stdout += d.toString(); pump(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(safety); reject(err); });
    child.on('close', code => { clearTimeout(safety); resolve({ code, stdout, stderr }); });
  });
}

describe.skipIf(!distPresent)('officeos onboard — black-box CLI E2E', () => {
  let tempRoot: string;
  let tempHome: string;

  beforeAll(() => {
    if (!distPresent) {
      // eslint-disable-next-line no-console
      console.warn('dist/cli.js missing — run `npm run build` before the E2E suite. Skipping.');
    }
  });

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'onboard-e2e-'));
    tempHome = mkdtempSync(join(tmpdir(), 'onboard-home-'));
    symlinkSync(join(repoRoot, 'dist'), join(tempRoot, 'dist'), 'dir');
    symlinkSync(join(repoRoot, 'templates'), join(tempRoot, 'templates'), 'dir');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  // Prompt markers — used to drive each turn deterministically.
  const P = {
    org: /Team \/ org name:/,
    orch: /Orchestrator name/,
    bot: /Bot token \(xoxb/,
    app: /App-level token/,
    user: /Your Slack user id/,
    chan: /Channel id for this team/,
    domain: /Restrict to a company email domain/,
    domainVal: /Allowed domain\(s\)/,
    addSpec: /Add a specialist to this team/,
    specName: /Specialist name:/,
    title: /One-line title/,
    desc: /What does it handle/,
    share: /Share this agent across all teams/,
    reuse: /Reuse the same Slack app/,
    moreTeams: /Add another team/,
  };
  const step = (expect: RegExp, answer: string): Step => ({ expect, answer });

  it('builds a one-team office: Slack .env, swapped hooks, shared JD, registry', async () => {
    const { code, stdout } = await driveWizard(tempRoot, tempHome, [
      step(P.org, 'docs'), step(P.orch, 'docs-orch'),
      step(P.bot, 'xoxb-test'), step(P.app, 'xapp-test'),
      step(P.user, 'U01OWNER23'), step(P.chan, 'C01DOCS234'), step(P.domain, 'n'),
      step(P.addSpec, 'y'), step(P.specName, 'doc-writer'),
      step(P.title, 'Documentation Specialist'), step(P.desc, 'Writes and edits internal docs'),
      step(P.share, 'y'), step(P.addSpec, 'n'), step(P.moreTeams, 'n'),
    ]);
    expect(code, stdout).toBe(0);
    expect(stdout).toMatch(/Onboarding complete/);

    const orchDir = join(tempRoot, 'orgs', 'docs', 'agents', 'docs-orch');
    const env = readFileSync(join(orchDir, '.env'), 'utf-8');
    expect(env).toContain('SLACK_BOT_TOKEN=xoxb-test');
    expect(env).toContain('SLACK_USER_ID=U01OWNER23');
    expect(env).toContain('SLACK_CHANNEL_ID=C01DOCS234');

    const settings = readFileSync(join(orchDir, '.claude', 'settings.json'), 'utf-8');
    expect(settings).toContain('hook-permission-slack.js');
    expect(settings).not.toContain('telegram');

    const specCfg = JSON.parse(readFileSync(join(tempRoot, 'orgs', 'docs', 'agents', 'doc-writer', 'config.json'), 'utf-8'));
    expect(specCfg.jd.title).toBe('Documentation Specialist');
    expect(specCfg.jd.shared).toBe(true);

    const registry = readFileSync(join(orchDir, 'jds-registry.md'), 'utf-8');
    expect(registry).toContain('doc-writer');
  }, 60000);

  it('shared agent crosses orgs; team-internal does not', async () => {
    const { code, stdout } = await driveWizard(tempRoot, tempHome, [
      // team 1: docs with a SHARED codebase agent + a PRIVATE doc-writer
      step(P.org, 'docs'), step(P.orch, 'docs-orch'),
      step(P.bot, 'xoxb-test'), step(P.app, 'xapp-test'),
      step(P.user, 'U01OWNER23'), step(P.chan, 'C01DOCS234'), step(P.domain, 'n'),
      step(P.addSpec, 'y'), step(P.specName, 'codebase'), step(P.title, 'Codebase Expert'), step(P.desc, 'Explains internal code'), step(P.share, 'y'),
      step(P.addSpec, 'y'), step(P.specName, 'doc-writer'), step(P.title, 'Doc Specialist'), step(P.desc, 'Writes docs'), step(P.share, 'n'),
      step(P.addSpec, 'n'), step(P.moreTeams, 'y'),
      // team 2: marketing, reuse slack app, own channel
      step(P.org, 'marketing'), step(P.orch, 'marketing-orch'),
      step(P.reuse, 'y'), step(P.user, ''), step(P.chan, 'C02MKTG567'), step(P.domain, 'n'),
      step(P.addSpec, 'n'), step(P.moreTeams, 'n'),
    ]);
    expect(code, stdout).toBe(0);

    const mktgRegistry = readFileSync(
      join(tempRoot, 'orgs', 'marketing', 'agents', 'marketing-orch', 'jds-registry.md'), 'utf-8');
    expect(mktgRegistry).toContain('codebase');       // shared → visible
    expect(mktgRegistry).not.toContain('doc-writer'); // private → hidden
  }, 60000);

  it('blocks a duplicate agent name and re-prompts', async () => {
    const { code, stdout } = await driveWizard(tempRoot, tempHome, [
      step(P.org, 'docs'), step(P.orch, 'docs-orch'),
      step(P.bot, 'xoxb-test'), step(P.app, 'xapp-test'),
      step(P.user, 'U01OWNER23'), step(P.chan, 'C01DOCS234'), step(P.domain, 'n'),
      step(P.addSpec, 'y'),
      step(P.specName, 'docs-orch'),  // duplicate of the orchestrator — rejected
      step(P.specName, 'doc-writer'), // valid retry
      step(P.title, 'Doc Specialist'), step(P.desc, 'Writes docs'), step(P.share, 'n'),
      step(P.addSpec, 'n'), step(P.moreTeams, 'n'),
    ]);
    expect(code, stdout).toBe(0);
    expect(stdout).toMatch(/already taken/i);
    expect(existsSync(join(tempRoot, 'orgs', 'docs', 'agents', 'doc-writer'))).toBe(true);
  }, 60000);

  it('re-prompts when owner id is the bot id, and on a malformed channel id', async () => {
    const { code, stdout } = await driveWizard(tempRoot, tempHome, [
      step(P.org, 'docs'), step(P.orch, 'docs-orch'),
      step(P.bot, 'xoxb-test'), step(P.app, 'xapp-test'),
      step(P.user, 'UBOTMOCK01'),  // the mock bot's own id — rejected
      step(P.user, 'U01OWNER23'),  // real owner
      step(P.chan, 'badchan'),     // malformed — rejected
      step(P.chan, 'C01DOCS234'),  // valid
      step(P.domain, 'n'),
      step(P.addSpec, 'n'), step(P.moreTeams, 'n'),
    ]);
    expect(code, stdout).toBe(0);
    expect(stdout).toMatch(/bot's own user id/i);
    expect(stdout).toMatch(/does not look like a Slack channel id/i);
    const env = readFileSync(join(tempRoot, 'orgs', 'docs', 'agents', 'docs-orch', '.env'), 'utf-8');
    expect(env).toContain('SLACK_USER_ID=U01OWNER23');
    expect(env).toContain('SLACK_CHANNEL_ID=C01DOCS234');
  }, 60000);

  it('collects an allowed email domain and writes SLACK_ALLOWED_DOMAINS', async () => {
    const { code, stdout } = await driveWizard(tempRoot, tempHome, [
      step(P.org, 'docs'), step(P.orch, 'docs-orch'),
      step(P.bot, 'xoxb-test'), step(P.app, 'xapp-test'),
      step(P.user, 'U01OWNER23'), step(P.chan, 'C01DOCS234'),
      step(P.domain, 'y'), step(P.domainVal, 'acme.com'),
      step(P.addSpec, 'n'), step(P.moreTeams, 'n'),
    ]);
    expect(code, stdout).toBe(0);
    const env = readFileSync(join(tempRoot, 'orgs', 'docs', 'agents', 'docs-orch', '.env'), 'utf-8');
    expect(env).toContain('SLACK_ALLOWED_DOMAINS=acme.com');
  }, 60000);
});

// Live Slack — opt-in. Requires real bot+app tokens; hits api.slack.com.
describe.runIf(process.env.OFFICEOS_E2E_LIVE_SLACK === '1' && distPresent)('officeos onboard — LIVE Slack', () => {
  let tempRoot: string;
  let tempHome: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'onboard-live-'));
    tempHome = mkdtempSync(join(tmpdir(), 'onboard-live-home-'));
    symlinkSync(join(repoRoot, 'dist'), join(tempRoot, 'dist'), 'dir');
    symlinkSync(join(repoRoot, 'templates'), join(tempRoot, 'templates'), 'dir');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('validates a real bot token against api.slack.com', async () => {
    const botToken = process.env.SLACK_BOT_TOKEN!;
    const appToken = process.env.SLACK_APP_TOKEN || 'xapp-unused';
    const userId = process.env.SLACK_USER_ID || 'U00000000';
    const channelId = process.env.SLACK_CHANNEL_ID || 'C00000000';
    // No OFFICEOS_CHANNEL_ADAPTER override → real Slack adapter.
    const { code, stdout } = await driveWizard(tempRoot, tempHome, [
      { expect: /Team \/ org name:/, answer: 'docs' },
      { expect: /Orchestrator name/, answer: 'docs-orch' },
      { expect: /Bot token \(xoxb/, answer: botToken },
      { expect: /App-level token/, answer: appToken },
      { expect: /Your Slack user id/, answer: userId },
      { expect: /Channel id for this team/, answer: channelId },
      { expect: /Restrict to a company email domain/, answer: 'n' },
      { expect: /Add a specialist to this team/, answer: 'n' },
      { expect: /Add another team/, answer: 'n' },
    ], { OFFICEOS_CHANNEL_ADAPTER: '' });
    expect(code, stdout).toBe(0);
    expect(stdout).toMatch(/Validated bot token/);
  }, 60000);
});
