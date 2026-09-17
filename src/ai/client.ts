export interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqCompletionOptions {
  messages: GroqMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export class GroqClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly cache = new Map<string, { reply: string; timestamp: number }>();
  private readonly cacheTtlMs = 15 * 60 * 1000; // 15 minutes response cache to save tokens

  constructor(apiKey?: string, model = 'llama-3.1-8b-instant') {
    this.apiKey = apiKey !== undefined ? apiKey : (process.env.GROQ_API_KEY || '');
    this.model = process.env.GROQ_MODEL || model;
  }

  hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey !== 'your_groq_api_key_here';
  }

  async complete(options: GroqCompletionOptions): Promise<string> {
    if (!this.hasApiKey()) {
      return '';
    }

    // Check token-saving cache
    const cacheKey = JSON.stringify(options.messages);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.reply;
    }

    const payload = {
      model: options.model || this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens ?? 400,
      stream: false,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error HTTP ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';

    // Save to cache
    this.cache.set(cacheKey, { reply, timestamp: Date.now() });

    return reply;
  }

  async *streamComplete(options: GroqCompletionOptions): AsyncGenerator<string, void, unknown> {
    if (!this.hasApiKey()) {
      return;
    }

    const payload = {
      model: options.model || this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.max_tokens ?? 400,
      stream: true,
    };

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text();
      throw new Error(`Groq API error HTTP ${res.status}: ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') return;

        try {
          const parsed = JSON.parse(jsonStr);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            yield chunk;
          }
        } catch {
          // ignore stream parse errors
        }
      }
    }
  }
}
