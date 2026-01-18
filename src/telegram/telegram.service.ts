import { Injectable } from '@nestjs/common';

interface StoredMessage {
  text: string;
  username: string;
  date: Date;
}

@Injectable()
export class TelegramService {
  private messageBuffer: StoredMessage[] = [];

  addMessage(text: string, username: string): number {
    this.messageBuffer.push({
      text,
      username,
      date: new Date(),
    });
    return this.messageBuffer.length;
  }

  getMessagesText(): string[] {
    return this.messageBuffer.map((m) => m.text);
  }

  clearBuffer(): void {
    this.messageBuffer = [];
  }

  getCount(): number {
    return this.messageBuffer.length;
  }
}
