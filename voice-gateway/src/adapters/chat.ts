import dotenv from 'dotenv';

dotenv.config();

export interface ChatResponseStream {
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | any;
  sessionId?: string;
}

export interface ChatProvider {
  sendChat(params: {
    message: string;
    tenantId: string;
    userId: string;
    sessionId?: string;
  }): Promise<ChatResponseStream>;
}

/**
 * MockChatProvider routes chat messages to our internal Chatbot API (chatbot-api).
 * Today, this chatbot-api calls the live Gemini 2.5 Flash API or runs mock streaming.
 */
export class MockChatProvider implements ChatProvider {
  private chatbotApiUrl: string;

  constructor(chatbotApiUrl: string) {
    this.chatbotApiUrl = chatbotApiUrl || 'http://localhost:5001';
  }

  async sendChat(params: {
    message: string;
    tenantId: string;
    userId: string;
    sessionId?: string;
  }): Promise<ChatResponseStream> {
    const url = `${this.chatbotApiUrl}/chat`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: params.message,
        tenantId: params.tenantId,
        userId: params.userId,
        sessionId: params.sessionId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MockChatProvider call failed with status ${response.status}: ${errorText}`);
    }

    const sessionId = response.headers.get('X-Session-ID') || undefined;

    return {
      stream: response.body,
      sessionId
    };
  }
}
