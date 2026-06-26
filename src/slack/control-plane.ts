import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { SlackAPI } from './api.js';
import { SlackSocketClient } from './socket-client.js';
import { stripControlChars, sanitizeForPtyInjection, wrapFenceSafe } from '../utils/validate.js';
import type { AgentConfig } from '../types/index.js';

type LogFn = (msg: string) => void;

interface FastCheckerLike {
  queueSlackMessage(formatted: string): void;
  isDuplicate(text: string): boolean;
}

interface AgentEntry {
  api: SlackAPI;
  socket: SlackSocketClient;
  channelId: string;
  stateDir: string;
}

const ALLOW_RE = /^allow$/i;
const DENY_RE  = /^deny$/i;

function handleApprovalReply(stateDir: string, decision: 'allow' | 'deny', log: LogFn): boolean {
  // Find the most recently modified .pending file (hook-response or tool-approval)
  let latest: { path: string; mtime: number; prefix: string } | null = null;

  for (const prefix of ['hook-response', 'tool-approval']) {
    try {
      const { readdirSync, statSync } = require('fs');
      const files = readdirSync(stateDir).filter((f: string) => f.startsWith(prefix + '-') && f.endsWith('.pending'));
      for (const f of files) {
        const p = join(stateDir, f);
        const mtime = statSync(p).mtimeMs;
        if (!latest || mtime > latest.mtime) latest = { path: p, mtime, prefix };
      }
    } catch { /* stateDir may not exist yet */ }
  }

  if (!latest) {
    log(`Slack: got "${decision}" but no pending approval files found`);
    return true; // consume as approval-intent even with no pending
  }

  try {
    const meta = JSON.parse(readFileSync(latest.path, 'utf-8'));
    const uniqueId = meta.uniqueId || meta.approvalId;
    if (!uniqueId) { log(`Slack: pending file missing uniqueId: ${latest.path}`); return true; }

    const responseFile = join(stateDir, `${latest.prefix}-${uniqueId}.json`);
    writeFileSync(responseFile, JSON.stringify({ decision, ts: Date.now() }), 'utf-8');
    log(`Slack: approval written: ${decision} → ${latest.prefix}-${uniqueId}.json`);
    try { unlinkSync(latest.path); } catch {}
  } catch (err: any) {
    log(`Slack: approval write error: ${err.message}`);
  }

  return true;
}

export class SlackControlPlane {
  private agents = new Map<string, AgentEntry>();

  constructor(_frameworkRoot: string) {}

  async init(
    name: string,
    agentDir: string,
    checker: FastCheckerLike,
    config: AgentConfig,
    log: LogFn,
    ctxRoot: string,
  ): Promise<void> {
    if (config.slack_polling === false) return;

    const envFile = join(agentDir, '.env');
    if (!existsSync(envFile)) return;

    const envContent = readFileSync(envFile, 'utf-8');
    const botToken   = envContent.match(/^SLACK_BOT_TOKEN=(.+)$/m)?.[1]?.trim();
    const appToken   = envContent.match(/^SLACK_APP_TOKEN=(.+)$/m)?.[1]?.trim();
    const channelId  = envContent.match(/^SLACK_CHANNEL_ID=(.+)$/m)?.[1]?.trim();
    const allowedUserId = envContent.match(/^SLACK_USER_ID=(.+)$/m)?.[1]?.trim();

    if (!botToken || !appToken || !channelId) return;

    const stateDir = join(ctxRoot, 'state', name);
    mkdirSync(stateDir, { recursive: true });

    const api    = new SlackAPI(botToken);
    const socket = new SlackSocketClient(appToken);

    socket.onMessage((event) => {
      if (allowedUserId && event.user !== allowedUserId) {
        log(`Slack: ignoring message from unauthorized user ${event.user}`);
        return;
      }

      const isDM              = event.channel_type === 'im';
      const isConfiguredChannel = event.channel === channelId;
      if (!isDM && !isConfiguredChannel) return;

      const text = (event.text || '').trim();

      // Approval routing: "allow" / "deny" → write response file, don't inject to agent
      if (ALLOW_RE.test(text)) { handleApprovalReply(stateDir, 'allow', log); return; }
      if (DENY_RE.test(text))  { handleApprovalReply(stateDir, 'deny',  log); return; }

      // Normal message → inject into agent PTY
      const from = stripControlChars(event.user || 'slack-user');
      const isSlashCommand = /^\/[a-zA-Z]/.test(stripControlChars(text).trim());
      const body = isSlashCommand
        ? sanitizeForPtyInjection(text).trim()
        : wrapFenceSafe(text);

      const formatted = `=== SLACK from [USER: ${sanitizeForPtyInjection(from)}] (channel:${event.channel}) ===\n${body}\nReply using: officeos bus send-slack ${event.channel} '<your reply>'\n\n`;

      if (!checker.isDuplicate(formatted)) {
        checker.queueSlackMessage(formatted);
        log(`Slack: queued message from ${from}`);
      }
    });

    try {
      await socket.start();
      this.agents.set(name, { api, socket, channelId, stateDir });
      log(`Slack: Socket Mode connected (channel: ${channelId})`);
    } catch (err: any) {
      log(`Slack: socket start failed: ${err.message}`);
    }
  }

  async cleanup(name: string): Promise<void> {
    const entry = this.agents.get(name);
    if (!entry) return;
    try { await entry.socket.stop(); } catch {}
    this.agents.delete(name);
  }

  getAPI(name: string): SlackAPI | undefined {
    return this.agents.get(name)?.api;
  }

  getChannelId(name: string): string | undefined {
    return this.agents.get(name)?.channelId;
  }
}
