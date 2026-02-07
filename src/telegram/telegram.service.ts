import { Injectable } from '@nestjs/common';

interface StoredMessage {
  text: string;
  username: string;
  date: Date;
}

@Injectable()
export class TelegramService {
  private chatBuffers: Map<number, StoredMessage[]> = new Map();

  addMessage(chatId: number, text: string, username: string): number {
    if (!this.chatBuffers.has(chatId)) {
      this.chatBuffers.set(chatId, []);
    }
    const buffer = this.chatBuffers.get(chatId)!;
    buffer.push({
      text,
      username,
      date: new Date(),
    });
    return buffer.length;
  }

  getMessagesText(chatId: number): string[] {
    const buffer = this.chatBuffers.get(chatId);
    return buffer ? buffer.map((m) => m.text) : [];
  }

  getMessages(chatId: number): { text: string; username: string }[] {
    const buffer = this.chatBuffers.get(chatId);
    return buffer ? buffer.map((m) => ({ text: m.text, username: m.username })) : [];
  }

  clearBuffer(chatId: number): void {
    this.chatBuffers.delete(chatId);
  }

  getCount(chatId: number): number {
    const buffer = this.chatBuffers.get(chatId);
    return buffer ? buffer.length : 0;
  }
}
