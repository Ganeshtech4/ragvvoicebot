import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { transcribeAudio } from './adapters/stt';
import { synthesizeSpeech } from './adapters/tts';
import { sessionManager } from './services/sessionManager';

dotenv.config();

const app = express();
const port = process.env.PORT || 5002;
const chatbotApiUrl = process.env.CHATBOT_API_URL || 'http://localhost:5001';

app.use(cors());
app.use(express.json());

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB limit

// --- HTTP ENDPOINTS ---

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'voice-gateway' });
});

// POST /voice/transcribe: Accepts a single audio file and returns its transcription
app.post('/voice/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    const text = await transcribeAudio(req.file.buffer, req.file.mimetype);
    return res.json({ text });
  } catch (error) {
    console.error('Error during HTTP transcribe:', error);
    return res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

// POST /voice/speak: Accepts text and returns an audio stream
app.post('/voice/speak', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const audioBuffer = await synthesizeSpeech(text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
  } catch (error) {
    console.error('Error during HTTP speak:', error);
    return res.status(500).json({ error: 'Failed to synthesize speech' });
  }
});


// --- WEBSOCKET SERVER FOR REAL-TIME STREAMING ---

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  const connectionId = Math.random().toString(36).substring(2, 15);
  console.log(`WebSocket client connected: ${connectionId}`);

  let activeSessionId: string | null = null;

  ws.on('message', async (message: any, isBinary: boolean) => {
    if (isBinary) {
      // Receive binary audio data from user's microphone
      if (activeSessionId) {
        sessionManager.appendAudio(activeSessionId, message as Buffer);
      }
      return;
    }

    // Process control messages (JSON)
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'start': {
          const { tenantId, userId, sessionId } = data;
          if (!tenantId || !userId) {
            ws.send(JSON.stringify({ type: 'error', message: 'tenantId and userId are required' }));
            return;
          }
          activeSessionId = connectionId;
          sessionManager.register(connectionId, ws, tenantId, userId, sessionId);
          ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          console.log(`Session initialized for user ${userId}, tenant ${tenantId}`);
          break;
        }

        case 'stop': {
          if (!activeSessionId) {
            ws.send(JSON.stringify({ type: 'error', message: 'No active session' }));
            return;
          }

          const session = sessionManager.get(activeSessionId);
          if (!session || session.audioChunks.length === 0) {
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
            return;
          }

          session.isProcessing = true;
          ws.send(JSON.stringify({ type: 'status', status: 'processing' }));

          // 1. Combine audio chunks
          const audioBuffer = Buffer.concat(session.audioChunks);
          session.audioChunks = []; // Clear chunk history

          // 2. Transcribe Audio (STT)
          console.log(`Transcribing audio buffer of size ${audioBuffer.length} bytes...`);
          const userTranscript = await transcribeAudio(audioBuffer, 'audio/webm');
          
          if (!session.isProcessing) return; // session interrupted

          // Send transcript of user speech
          ws.send(JSON.stringify({
            type: 'transcript',
            sender: 'user',
            text: userTranscript,
            isFinal: true
          }));

          if (!userTranscript.trim()) {
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
            session.isProcessing = false;
            return;
          }

          // 3. Contact Chatbot API
          console.log(`Sending query to chatbot-api: "${userTranscript}"`);
          const chatResponse = await fetch(`${chatbotApiUrl}/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: userTranscript,
              tenantId: session.tenantId,
              userId: session.userId,
              sessionId: session.sessionId
            })
          });

          if (!chatResponse.ok) {
            throw new Error(`Chatbot API error: ${chatResponse.statusText}`);
          }

          // Read headers to capture/update Session ID
          const returnedSessionId = chatResponse.headers.get('X-Session-ID');
          if (returnedSessionId && !session.sessionId) {
            session.sessionId = returnedSessionId;
            ws.send(JSON.stringify({
              type: 'session_created',
              sessionId: returnedSessionId
            }));
          }

          // Stream the chat response body and split it into sentences for low latency TTS
          const reader = chatResponse.body?.getReader();
          if (!reader) {
            throw new Error('Chatbot response reader is undefined');
          }

          const decoder = new TextDecoder();
          let sentenceBuffer = '';
          let fullText = '';
          ws.send(JSON.stringify({ type: 'status', status: 'playing' }));

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!session.isProcessing) {
              // User interrupted the session (barge-in)
              await reader.cancel();
              return;
            }

            const chunkText = decoder.decode(value, { stream: true });
            fullText += chunkText;
            sentenceBuffer += chunkText;

            // Stream text chunk directly to UI
            ws.send(JSON.stringify({
              type: 'transcript',
              sender: 'assistant',
              text: chunkText,
              isFinal: false
            }));

            // Sentence boundary detection for TTS chunking (periods, question marks, newlines)
            const sentenceBoundaryRegex = /([.?!。？！\n])\s*/g;
            let match;
            let lastIndex = 0;

            while ((match = sentenceBoundaryRegex.exec(sentenceBuffer)) !== null) {
              const sentence = sentenceBuffer.substring(lastIndex, match.index + match[1].length).trim();
              lastIndex = sentenceBoundaryRegex.lastIndex;

              if (sentence.length > 2) {
                // Synthesize speech for this sentence and stream immediately to client
                console.log(`Synthesizing sentence: "${sentence}"`);
                try {
                  const speechBuffer = await synthesizeSpeech(sentence);
                  if (session.isProcessing) {
                    ws.send(JSON.stringify({
                      type: 'audio',
                      data: speechBuffer.toString('base64'),
                      text: sentence
                    }));
                  }
                } catch (e) {
                  console.error('Error synthesizing speech chunk:', e);
                }
              }
            }

            // Keep remaining incomplete sentence fragment in the buffer
            sentenceBuffer = sentenceBuffer.substring(lastIndex);
          }

          // Synthesize any remaining text in the buffer
          if (sentenceBuffer.trim().length > 0 && session.isProcessing) {
            console.log(`Synthesizing final sentence: "${sentenceBuffer}"`);
            try {
              const speechBuffer = await synthesizeSpeech(sentenceBuffer);
              ws.send(JSON.stringify({
                type: 'audio',
                data: speechBuffer.toString('base64'),
                text: sentenceBuffer
              }));
            } catch (e) {
              console.error('Error synthesizing final speech chunk:', e);
            }
          }

          // Mark transcript as completed
          ws.send(JSON.stringify({
            type: 'transcript',
            sender: 'assistant',
            text: '',
            isFinal: true
          }));

          ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          session.isProcessing = false;
          break;
        }

        case 'interrupt': {
          if (activeSessionId) {
            console.log(`Session interrupted (barge-in) by client: ${activeSessionId}`);
            sessionManager.clearAudio(activeSessionId);
            ws.send(JSON.stringify({ type: 'status', status: 'ready' }));
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error parsing JSON message:', e);
    }
  });

  ws.on('close', () => {
    if (activeSessionId) {
      sessionManager.remove(activeSessionId);
      console.log(`WebSocket client disconnected and session removed: ${activeSessionId}`);
    }
  });
});

// Upgrade HTTP server requests to WebSocket connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`Voice Gateway server listening on port ${port}`);
});
