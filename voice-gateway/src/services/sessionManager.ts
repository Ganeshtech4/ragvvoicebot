import { WebSocket } from 'ws';

export interface VoiceSession {
  ws: WebSocket;
  tenantId: string;
  userId: string;
  sessionId?: string;
  audioChunks: Buffer[];
  isProcessing: boolean;
}

export class SessionManager {
  private sessions: Map<string, VoiceSession> = new Map();

  /**
   * Registers a new voice session
   */
  public register(id: string, ws: WebSocket, tenantId: string, userId: string, sessionId?: string): VoiceSession {
    const session: VoiceSession = {
      ws,
      tenantId,
      userId,
      sessionId,
      audioChunks: [],
      isProcessing: false,
    };
    this.sessions.set(id, session);
    return session;
  }

  /**
   * Retrieves a session by ID
   */
  public get(id: string): VoiceSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Removes a session
   */
  public remove(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * Appends audio data to the session's buffer
   */
  public appendAudio(id: string, data: Buffer): void {
    const session = this.sessions.get(id);
    if (session) {
      session.audioChunks.push(data);
    }
  }

  /**
   * Clears accumulated audio data and resets processing state
   */
  public clearAudio(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.audioChunks = [];
      session.isProcessing = false;
    }
  }

  /**
   * Sets processing flag
   */
  public setProcessing(id: string, processing: boolean): void {
    const session = this.sessions.get(id);
    if (session) {
      session.isProcessing = processing;
    }
  }
}
export const sessionManager = new SessionManager();
