import { exec } from 'child_process';
import { promisify } from 'util';
import type { AgentConfig } from '../types/index.js';

const execAsync = promisify(exec);

let headroomPath: string | null | undefined = undefined;

export async function resolveHeadroom(): Promise<string | null> {
  if (process.env.HEADROOM_ENABLED === 'false') return null;
  if (headroomPath !== undefined) return headroomPath;
  try {
    const { stdout } = await execAsync('which headroom');
    headroomPath = stdout.trim() || null;
  } catch {
    headroomPath = null;
  }
  return headroomPath;
}

export async function applyHeadroom(
  cmd: string[],
  env: NodeJS.ProcessEnv,
  config: AgentConfig,
  runtime: 'claude-code' | 'codex',
): Promise<{ cmd: string[]; env: NodeJS.ProcessEnv }> {
  if (config.headroom?.enabled === false) return { cmd, env };
  const bin = await resolveHeadroom();
  if (!bin) return { cmd, env };
  const mode = config.headroom?.mode ?? 'wrap';
  if (mode === 'wrap') {
    return { cmd: [bin, 'wrap', '--', ...cmd], env };
  }
  const port = config.headroom?.port ?? 8787;
  return {
    cmd,
    env: {
      ...env,
      ...(runtime === 'claude-code'
        ? { ANTHROPIC_BASE_URL: `http://localhost:${port}` }
        : { OPENAI_BASE_URL: `http://localhost:${port}` }),
    },
  };
}
