import { existsSync, readFileSync } from 'fs';
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
  ): Promise<void> {
    if (config.slack_polling === false) return;

    const envFile = join(agentDir, '.env');
    if (!existsSync(envFile)) return;

    const envContent = readFileSync(envFile, 'utf-8');
    const botToken = envContent.match(/^SLACK_BOT_TOKEN=(.+)$/m)?.[1]?.trim();
    const appToken = envContent.match(/^SLACK_APP_TOKEN=(.+)$/m)?.[1]?.trim();
    const channelId = envContent.match(/^SLACK_CHANNEL_ID=(.+)$/m)?.[1]?.trim();
    const allowedUserId = envContent.match(/^SLACK_USER_ID=(.+)$/m)?.[1]?.trim();

    if (!botToken || !appToken || !channelId) {
      return; // Slack not configured for this agent — silent skip
    }

    const api = new SlackAPI(botToken);
    const socket = new SlackSocketClient(appToken);

    socket.onMessage((event) => {
      if (allowedUserId && event.user !== allowedUserId) {
        log(`Slack: ignoring message from unauthorized user ${event.user}`);
        return;
      }

      const isDM = event.channel_type === 'im';
      const isConfiguredChannel = event.channel === channelId;
      if (!isDM && !isConfiguredChannel) return;

      const from = stripControlChars(event.user || 'slack-user');
      const text = event.text || '';
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
      this.agents.set(name, { api, socket, channelId });
      log(`Slack: Socket Mode connected (channel: ${channelId})`);
    } catch (err: any) {
      log(`Slack: socket start failed: ${err.message}`);
    }
  }

  async cleanup(name: string): Promise<void> {
    const entry = this.agents.get(name);
    if (!entry) return;
    try {
      await entry.socket.stop();
    } catch {
      // ignore disconnect errors on cleanup
    }
    this.agents.delete(name);
  }

  getAPI(name: string): SlackAPI | undefined {
    return this.agents.get(name)?.api;
  }

  getChannelId(name: string): string | undefined {
    return this.agents.get(name)?.channelId;
  }
}
