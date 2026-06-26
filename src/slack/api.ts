import { WebClient } from '@slack/web-api';

const MAX_MESSAGE_LENGTH = 3000;

function splitText(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, MAX_MESSAGE_LENGTH));
    remaining = remaining.slice(MAX_MESSAGE_LENGTH);
  }
  return chunks;
}

export class SlackAPI {
  private client: WebClient;

  constructor(botToken: string) {
    this.client = new WebClient(botToken);
  }

  async sendMessage(channelId: string, text: string): Promise<{ ts: string; channel: string } | null> {
    const chunks = splitText(text);
    let result: { ts: string; channel: string } | null = null;
    for (const chunk of chunks) {
      const res = await this.client.chat.postMessage({
        channel: channelId,
        text: chunk,
        mrkdwn: true,
      });
      if (!result && res.ts && res.channel) {
        result = { ts: res.ts, channel: res.channel };
      }
    }
    return result;
  }

  async updateMessage(channelId: string, ts: string, text: string): Promise<void> {
    await this.client.chat.update({ channel: channelId, ts, text });
  }
}
