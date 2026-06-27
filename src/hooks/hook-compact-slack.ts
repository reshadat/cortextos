import { join } from 'path';
import { sendToReplyTarget } from '../channels/send.js';

async function main(): Promise<void> {
  const agentName = process.env.CTX_AGENT_NAME || 'agent';
  const agentDir = process.env.CTX_AGENT_DIR || '';
  const ctxRoot = process.env.CTX_ROOT || join(require('os').homedir(), '.officeos', 'default');
  const stateDir = join(ctxRoot, 'state', agentName);

  const message = `[Context] *${agentName}* is compacting context (context window near limit).`;
  try {
    await sendToReplyTarget(agentDir, stateDir, message);
  } catch {
    // Non-fatal, non-blocking
  }
}

main().catch(() => process.exit(0));
