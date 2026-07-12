import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const provider = (process.env.STT_PROVIDER || 'mock').toLowerCase();
const apiKey = process.env.STT_API_KEY || process.env.OPENAI_API_KEY || 'mock';
const customUrl = process.env.STT_API_URL || '';
const modelName = process.env.STT_MODEL || 'whisper-1';

const mockQueries = [
  "How do I reset my password?",
  "What is the company VPN configuration?",
  "What should I do if the printer is offline?",
  "How do I take care of myself if I have the flu?",
  "What is the appointment cancellation policy?",
  "What are the healthy diet guidelines?"
];

let queryIndex = 0;

/**
 * Transcribes audio buffer to text using configurable STT API endpoint.
 */
export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  if (provider === 'mock') {
    return getNextMockQuery();
  }

  const tempDir = path.join(__dirname, '../../temp');
  let tempFilePath = '';

  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    let ext = 'webm';
    if (mimeType.includes('wav')) ext = 'wav';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('mp3')) ext = 'mp3';
    else if (mimeType.includes('m4a')) ext = 'm4a';

    tempFilePath = path.join(tempDir, `temp_audio_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    // Call API using FormData (Whisper-compatible format)
    const url = customUrl || 'https://api.openai.com/v1/audio/transcriptions';
    
    const formData = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', fileBlob, `audio.${ext}`);
    
    if (provider !== 'custom') {
      formData.append('model', modelName);
    }

    const headers: Record<string, string> = {};
    if (provider !== 'custom' && apiKey && apiKey !== 'mock') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT API responded with status ${response.status}: ${errText}`);
    }

    const data = await response.json() as { text: string };
    return data.text || '';
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`STT Transcription error (${provider}): request timed out.`);
    } else {
      console.error(`STT Transcription error (${provider}):`, error.message || error);
    }
    return getNextMockQuery();
  } finally {
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {
      console.error('Error cleaning up temp audio file:', e);
    }
  }
}

function getNextMockQuery(): string {
  const query = mockQueries[queryIndex];
  queryIndex = (queryIndex + 1) % mockQueries.length;
  return query;
}
