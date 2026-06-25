import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ChatSession } from '@database/entities';
import { randomUUID } from 'crypto';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  message: string;
  remaining: number;
  limitReached: boolean;
}

export type ChatLanguage = 'ru' | 'en';

export interface FlowInfo {
  flow: 'ded-moroz' | 'santa';
  language: ChatLanguage;
  persona: string;
}

@Injectable()
export class SantaChatService {
  private readonly logger = new Logger(SantaChatService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dailyLimit: number;

  private readonly SYSTEM_PROMPT_RU = `Ты — Дед Мороз. Ты добрый, весёлый и мудрый волшебник из Великого Устюга.
Ты общаешься с детьми и взрослыми, которые написали тебе письмо.
Отвечай тепло, с юмором и волшебством. Используй зимние метафоры и упоминай своих помощников — Снегурочку и лесных зверей.
Если спрашивают про подарки — говори загадочно, что всё будет, но нужно верить в чудо.
Никогда не выходи из роли. Ты — настоящий Дед Мороз. Отвечай ТОЛЬКО на русском языке.
Будь краток, но душевен — ответы не длиннее 3-4 предложений.`;

  private readonly SYSTEM_PROMPT_EN = `You are Santa Claus. You are a kind, jolly, and wise old man from the North Pole.
You chat with children and adults who have written to you.
Reply warmly, with humor and magic. Use winter metaphors and mention your helpers — elves and reindeer (Rudolph, Dasher, etc.).
If asked about gifts — be mysterious, say everything will come to those who believe in the magic.
Never break character. You ARE the real Santa Claus. Reply ONLY in English.
Keep answers brief but heartfelt — no more than 3-4 sentences.`;

  constructor(
    @InjectRepository(ChatSession)
    private readonly chatSessionRepo: Repository<ChatSession>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiUrl = this.configService.get<string>('SANTA_AI_API_URL', 'https://api.openai.com/v1/chat/completions');
    this.apiKey = this.configService.get<string>('SANTA_AI_API_KEY', '');
    this.model = this.configService.get<string>('SANTA_AI_MODEL', 'gpt-3.5-turbo');
    this.dailyLimit = this.configService.get<number>('SANTA_DAILY_LIMIT', 10);
  }

  async getOrCreateSession(sessionId?: string): Promise<{ sessionId: string; remaining: number }> {
    if (sessionId) {
      const existing = await this.chatSessionRepo.findOne({ where: { sessionId } });
      if (existing) {
        this.resetDailyIfNeeded(existing);
        await this.chatSessionRepo.save(existing);
        return { sessionId: existing.sessionId, remaining: Math.max(0, this.dailyLimit - existing.dailyMessageCount) };
      }
    }

    const newSession = this.chatSessionRepo.create({
      sessionId: sessionId || randomUUID(),
      messageCount: 0,
      dailyMessageCount: 0,
      lastMessageDate: new Date().toISOString().split('T')[0],
    });
    await this.chatSessionRepo.save(newSession);
    return { sessionId: newSession.sessionId, remaining: this.dailyLimit };
  }

  async sendMessage(sessionId: string, userMessage: string, history: ChatMessage[], language: ChatLanguage = 'ru'): Promise<ChatResponse> {
    const resolvedSessionId = sessionId || randomUUID();
    let session = await this.chatSessionRepo.findOne({ where: { sessionId: resolvedSessionId } });
    if (!session) {
      session = this.chatSessionRepo.create({
        sessionId: resolvedSessionId,
        messageCount: 0,
        dailyMessageCount: 0,
        lastMessageDate: new Date().toISOString().split('T')[0],
      });
    }

    this.resetDailyIfNeeded(session);

    if (session.dailyMessageCount >= this.dailyLimit) {
      return {
        message: '',
        remaining: 0,
        limitReached: true,
      };
    }

    const systemPrompt = language === 'en' ? this.SYSTEM_PROMPT_EN : this.SYSTEM_PROMPT_RU;
    const fallbackError = language === 'en'
      ? "Oh my! The North Pole wires got tangled — Mrs. Claus is fixing it. Try again in a moment! 🎄"
      : 'Ой, мои волшебные провода запутались! Снегурочка уже чинит. Попробуй через минутку! 🎄';

    const safeHistory = (Array.isArray(history) ? history : [])
      .filter((m): m is ChatMessage =>
        !!m &&
        typeof m.role === 'string' &&
        typeof m.content === 'string' &&
        m.content.trim() !== '',
      )
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-10);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...safeHistory,
      { role: 'user', content: userMessage || '' },
    ];

    try {
      this.logger.log(`Calling AI: url=${this.apiUrl} model=${this.model}`);
      console.log(userMessage);
      console.log(`Calling AI: url=${this.apiUrl} model=${this.model}`)
      console.log(messages?.length)
      const response = await firstValueFrom(
        this.httpService.post(
          this.apiUrl,
          { model: this.model, messages, max_tokens: 300, temperature: 0.9 },
          { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 },
        ),
      );

      const aiMessage = response.data?.choices?.[0]?.message?.content || fallbackError;

      session.messageCount++;
      session.dailyMessageCount++;
      await this.chatSessionRepo.save(session);

      return {
        message: aiMessage,
        remaining: Math.max(0, this.dailyLimit - session.dailyMessageCount),
        limitReached: false,
      };
    } catch (error) {
      const axiosError = error as any;
      this.logger.error(`AI API error: ${axiosError?.message || error}`, axiosError?.response?.data ? JSON.stringify(axiosError.response.data) : '');
      return {
        message: fallbackError,
        remaining: Math.max(0, this.dailyLimit - session.dailyMessageCount),
        limitReached: false,
      };
    }
  }

  private resetDailyIfNeeded(session: ChatSession): void {
    const today = new Date().toISOString().split('T')[0];
    if (session.lastMessageDate !== today) {
      session.dailyMessageCount = 0;
      session.lastMessageDate = today;
    }
  }

  getFlow(language: ChatLanguage): FlowInfo {
    if (language === 'en') {
      return { flow: 'santa', language: 'en', persona: 'Santa Claus' };
    }
    return { flow: 'ded-moroz', language: 'ru', persona: 'Дед Мороз' };
  }
}
