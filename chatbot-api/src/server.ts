import express, { Request, Response } from 'express';
import cors from 'cors';
import { pool } from './db/pg';
import { redisClient } from './db/redis';
import { retrieveRelevantContext } from './services/rag';
import { streamLLMResponse, ChatMessage } from './services/llm';

const app = express();
const port = process.env.PORT || 5001;

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
      return res.status(401).json({ error: 'Invalid username or password' });
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
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Chat Endpoint (Streaming Response via Chunked Transfer Encoding)
app.post('/chat', async (req: Request, res: Response) => {
  const { message, tenantId, userId, sessionId: reqSessionId } = req.body;

  if (!message || !tenantId || !userId) {
    return res.status(400).json({ error: 'message, tenantId, and userId are required' });
  }

  try {
    // Determine or create session
    let sessionId = reqSessionId;
    if (!sessionId) {
      const sessionRes = await pool.query(
        'INSERT INTO chat_sessions (tenant_id, user_id) VALUES ($1, $2) RETURNING id',
        [tenantId, userId]
      );
      sessionId = sessionRes.rows[0].id;
    }

    // Save User message in DB
    await pool.query(
      'INSERT INTO chat_messages (session_id, sender, text) VALUES ($1, $2, $3)',
      [sessionId, 'user', message]
    );

    // Fetch recent message history (last 5 exchanges) for LLM context
    const historyRes = await pool.query(
      'SELECT sender, text FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT 10',
      [sessionId]
    );
    
    // Map to ChatMessage format (excluding the current user message which is already included in prompt)
    const history: ChatMessage[] = historyRes.rows
      .filter((row: any) => row.text !== message || row.sender !== 'user')
      .map((row: any) => ({
        role: row.sender === 'user' ? 'user' : 'assistant',
        content: row.text
      }));

    // Retrieve RAG Context
    const context = await retrieveRelevantContext(tenantId, message);

    // Setup headers for HTTP Response Streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Session-ID', sessionId);

    // Cache the Session ID in Redis
    await redisClient.set(`session:${sessionId}:tenant`, tenantId);
    await redisClient.expire(`session:${sessionId}:tenant`, 3600); // 1 hour expiration

    let assistantResponse = '';

    // Stream LLM response
    await streamLLMResponse(message, context, history, (chunk) => {
      assistantResponse += chunk;
      res.write(chunk);
    });

    // Save Assistant message to Database
    if (assistantResponse) {
      await pool.query(
        'INSERT INTO chat_messages (session_id, sender, text) VALUES ($1, $2, $3)',
        [sessionId, 'assistant', assistantResponse]
      );
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
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Chatbot API listening on port ${port}`);
});
