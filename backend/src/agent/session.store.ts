import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatMessage } from '../llm/llm.types';
import { Session } from './agent.types';

const MAX_SESSIONS = 200;

/**
 * In-memory session store. Good enough for a single-node demo; a production
 * build would put this behind Redis with a TTL. Sessions are evicted LRU-style.
 */
@Injectable()
export class SessionStore {
  private sessions = new Map<string, Session>();

  getOrCreate(id?: string): Session {
    const key = id && /^[\w-]{6,64}$/.test(id) ? id : randomUUID();
    let s = this.sessions.get(key);
    if (!s) {
      const now = new Date().toISOString();
      s = { id: key, createdAt: now, updatedAt: now, messages: [], facts: {}, transcript: [], sourceCounter: 0 };
      this.sessions.set(key, s);
      this.evict();
    }
    // Refresh insertion order so the map behaves like an LRU.
    this.sessions.delete(key);
    this.sessions.set(key, s);
    return s;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  /**
   * Last N LLM messages, cut so the window never starts in the middle of a
   * tool exchange (a 'tool' message without its assistant tool_call is
   * rejected by every provider).
   */
  recentHistory(session: Session, maxMessages: number): ChatMessage[] {
    const msgs = session.messages;
    let start = Math.max(0, msgs.length - maxMessages);
    while (start < msgs.length && msgs[start].role !== 'user') start++;
    return msgs.slice(start);
  }

  private evict() {
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
}
