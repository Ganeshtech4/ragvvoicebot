import express, { Request, Response } from 'express';
import cors from 'cors';
import { pool } from './db/pg';
import { redisClient } from './db/redis';
import { retrieveRelevantContext } from './services/rag';
import { streamLLMResponse, ChatMessage } from './services/llm';

const app = express();
const port = process.env.PORT || 5001;

interface FallbackMessage {
  sender: string;
  text: string;
  createdAt: string;
}

interface FallbackSession {
  id: string;
  tenantId: string;
  userId: string;
  messages: FallbackMessage[];
}

const fallbackUsers: Record<string, { passwordHash: string; tenantId: string; tenantName: string; role: string; userId: string }> = {
  techuser: {
    passwordHash: 'password123',
    tenantId: 'tenant-tech',
    tenantName: 'TechSupport Corp',
    role: 'user',
    userId: 'user-tech-1'
  },
  healthuser: {
    passwordHash: 'password123',
    tenantId: 'tenant-health',
    tenantName: 'HealthAdvice Inc',
    role: 'user',
    userId: 'user-health-1'
  }
};

const fallbackSessions = new Map<string, FallbackSession>();

function getOrCreateFallbackSession(sessionId: string, userId: string, tenantId: string): FallbackSession {
  const existing = fallbackSessions.get(sessionId);
  if (existing) return existing;

  const created: FallbackSession = {
    id: sessionId,
    tenantId,
    userId,
    messages: []
  };
  fallbackSessions.set(sessionId, created);
  return created;
}

async function saveChatMessage(sessionId: string, sender: string, text: string, userId: string, tenantId: string) {
  try {
    await pool.query(
      'INSERT INTO chat_messages (session_id, sender, text) VALUES ($1, $2, $3)',
      [sessionId, sender, text]
    );
  } catch (error) {
    console.warn('Database unavailable, storing chat message in memory instead:', error);
    const session = getOrCreateFallbackSession(sessionId, userId, tenantId);
    session.messages.push({ sender, text, createdAt: new Date().toISOString() });
  }
}

async function loadChatHistory(sessionId: string, message: string, userId: string, tenantId: string): Promise<ChatMessage[]> {
  try {
    const historyRes = await pool.query(
      'SELECT sender, text FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 10',
      [sessionId]
    );

    return historyRes.rows
      .filter((row: any) => row.text !== message || row.sender !== 'user')
      .map((row: any) => ({
        role: row.sender === 'user' ? 'user' : 'assistant',
        content: row.text
      }));
  } catch (error) {
    console.warn('Database unavailable, using in-memory chat history:', error);
    const session = getOrCreateFallbackSession(sessionId, userId, tenantId);
    return session.messages
      .filter((row) => row.text !== message || row.sender !== 'user')
      .map((row) => ({
        role: row.sender === 'user' ? 'user' : 'assistant',
        content: row.text
      }));
  }
}

async function cacheSession(sessionId: string, tenantId: string) {
  try {
    await redisClient.set(`session:${sessionId}:tenant`, tenantId);
    await redisClient.expire(`session:${sessionId}:tenant`, 3600);
  } catch (error) {
    console.warn('Redis unavailable, skipping session cache:', error);
  }
}

app.use(cors());
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'chatbot-api' });
});

// 1. Authentication Endpoint
app.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, tenant_id, role, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      const fallbackUser = fallbackUsers[username];
      if (!fallbackUser || fallbackUser.passwordHash !== password) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      return res.json({
        userId: fallbackUser.userId,
        username,
        tenantId: fallbackUser.tenantId,
        tenantName: fallbackUser.tenantName,
        role: fallbackUser.role
      });
    }

    const user = result.rows[0];

    // Simple plain password verification for mock setup
    if (user.password_hash !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Fetch tenant name
    const tenantResult = await pool.query(
      'SELECT name FROM tenants WHERE id = $1',
      [user.tenant_id]
    );
    const tenantName = tenantResult.rows[0]?.name || 'Unknown Tenant';

    return res.json({
      userId: user.id,
      username: user.username,
      tenantId: user.tenant_id,
      tenantName,
      role: user.role
    });
  } catch (error) {
    console.warn('Database unavailable during login, using fallback auth:', error);
    const fallbackUser = fallbackUsers[username];
    if (!fallbackUser || fallbackUser.passwordHash !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    return res.json({
      userId: fallbackUser.userId,
      username,
      tenantId: fallbackUser.tenantId,
      tenantName: fallbackUser.tenantName,
      role: fallbackUser.role
    });
  }
});

// 2. Chat Endpoint (Streaming Response via Chunked Transfer Encoding)
app.post('/chat', async (req: Request, res: Response) => {
  const { message, tenantId, userId, sessionId: reqSessionId } = req.body;

  if (!message || !tenantId || !userId) {
    return res.status(400).json({ error: 'message, tenantId, and userId are required' });
  }

  try {
    let sessionId = reqSessionId;
    if (!sessionId) {
      try {
        const sessionRes = await pool.query(
          'INSERT INTO chat_sessions (tenant_id, user_id) VALUES ($1, $2) RETURNING id',
          [tenantId, userId]
        );
        sessionId = sessionRes.rows[0].id;
      } catch (dbError) {
        console.warn('Database unavailable while creating chat session, using fallback session:', dbError);
        sessionId = `fallback-${Date.now()}`;
      }
    }

    await saveChatMessage(sessionId, 'user', message, userId, tenantId);

    const history: ChatMessage[] = await loadChatHistory(sessionId, message, userId, tenantId);

    const context = await retrieveRelevantContext(tenantId, message);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Session-ID', sessionId);

    await cacheSession(sessionId, tenantId);

    let assistantResponse = '';

    await streamLLMResponse(message, context, history, (chunk) => {
      assistantResponse += chunk;
      res.write(chunk);
    });

    if (assistantResponse) {
      await saveChatMessage(sessionId, 'assistant', assistantResponse, userId, tenantId);
    }

    res.end();
  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.write('\n[ERROR: Internal server error]');
      res.end();
    }
  }
});

// 3. Get Sessions History
app.get('/sessions/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, created_at FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.warn('Database unavailable while fetching sessions, returning fallback sessions:', error);
    const fallbackSessionList = Array.from(fallbackSessions.values())
      .filter((session) => session.userId === userId)
      .map((session) => ({
        id: session.id,
        created_at: new Date().toISOString()
      }));
    res.json(fallbackSessionList);
  }
});

// 4. Get Session Messages
app.get('/messages/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  try {
    const result = await pool.query(
      'SELECT sender, text, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    );
    res.json(result.rows);
  } catch (error) {
    console.warn('Database unavailable while fetching messages, returning fallback messages:', error);
    const session = fallbackSessions.get(sessionId);
    res.json((session?.messages || []).map((message) => ({
      sender: message.sender,
      text: message.text,
      created_at: message.createdAt
    })));
  }
});

app.listen(port, () => {
  console.log(`Chatbot API listening on port ${port}`);
});
