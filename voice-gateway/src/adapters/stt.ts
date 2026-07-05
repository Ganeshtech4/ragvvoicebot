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

  try {
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    let ext = 'webm';
    if (mimeType.includes('wav')) ext = 'wav';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('mp3')) ext = 'mp3';
    else if (mimeType.includes('m4a')) ext = 'm4a';

    const tempFilePath = path.join(tempDir, `temp_audio_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    // Call API using FormData (Whisper-compatible format)
    const url = customUrl || 'https://api.openai.com/v1/audio/transcriptions';
    
    const formData = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', fileBlob, `audio.${ext}`);
    formData.append('model', modelName);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    // Cleanup temp file
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {
      console.error('Error cleaning up temp audio file:', e);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT API responded with status ${response.status}: ${errText}`);
    }

    const data = await response.json() as { text: string };
    return data.text || '';
  } catch (error) {
    console.error(`STT Transcription error (${provider}), falling back to mock:`, error);
    return getNextMockQuery();
  }
}

function getNextMockQuery(): string {
  const query = mockQueries[queryIndex];
  queryIndex = (queryIndex + 1) % mockQueries.length;
  return query;
}
