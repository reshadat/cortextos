import { SocketModeClient } from '@slack/socket-mode';
import type { SlackMessageEvent } from '../types/index.js';

type MessageHandler = (event: SlackMessageEvent) => void;

export class SlackSocketClient {
  private client: SocketModeClient;
  private handlers: MessageHandler[] = [];

  constructor(appToken: string) {
    this.client = new SocketModeClient({ appToken });

    this.client.on('message', ({ event }: { event: unknown }) => {
      const ev = event as SlackMessageEvent;
      if (ev && ev.type === 'message' && ev.text && !ev.bot_id) {
        for (const handler of this.handlers) {
          handler(ev);
        }
      }
    });

    this.client.on('error', (err: Error) => {
      console.error('[slack-socket] error:', err.message);
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
  }
}
