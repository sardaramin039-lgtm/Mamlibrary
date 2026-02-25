import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

export interface Message {
  role: 'user' | 'model';
  content: string;
  image?: string; // base64 string
  audio?: string; // base64 string
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  messages = signal<Message[]>([
    { role: 'model', content: 'سڵاو! من "کتێبخانەی مام"ـم، پڕۆفیسۆری زانکۆی هارڤارد و ئەندازیاری ئایتی و ژیری دەستکرد. چۆن دەتوانم هاوکارت بم لە نووسین و توێژینەوەی زانستیدا؟' }
  ]);
  isLoading = signal(false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadHistory();
    }
  }

  async loadHistory() {
    try {
      const response = await firstValueFrom(
        this.http.get<{messages: Message[]}>('/api/history')
      );
      if (response && response.messages && response.messages.length > 0) {
        this.messages.set(response.messages);
      }
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }

  async sendMessage(text: string, image?: string) {
    if (!text.trim() && !image) return;

    const userMessage: Message = { role: 'user', content: text, image };
    this.messages.update(msgs => [...msgs, userMessage]);
    this.isLoading.set(true);

    try {
      // Format history for the Gemini API
      const history = this.messages().map(m => {
        const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.image) {
          // Remove data:image/png;base64, prefix if present for the API call
          const base64Data = m.image.split(',')[1] || m.image;
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg', // Assuming jpeg for simplicity or detect from string
              data: base64Data
            }
          });
        }
        return {
          role: m.role,
          parts: parts
        };
      });

      // Send request to our Node.js backend which handles the API keys
      const response = await firstValueFrom(
        this.http.post<{reply: string}>('/api/chat', {
          message: text,
          history: history
        })
      );

      if (response && response.reply) {
        this.messages.update(msgs => [...msgs, { role: 'model', content: response.reply }]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      this.messages.update(msgs => [...msgs, { role: 'model', content: 'ببورە، هەڵەیەک ڕوویدا لە کاتی پەیوەندیکردن. تکایە دووبارە هەوڵ بدەرەوە.' }]);
    } finally {
      this.isLoading.set(false);
    }
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.http.post<{audio: string}>('/api/tts', { text })
      );
      return response.audio;
    } catch (error) {
      console.error('Error generating speech:', error);
      return null;
    }
  }
}
