import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY || 'mock';

// A pool of mock queries to rotate through for easy end-to-end testing in mock mode
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
 * Transcribes audio buffer to text.
 * @param audioBuffer The raw audio data
 * @param mimeType The audio mime type (e.g. audio/webm, audio/wav)
 */
export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  if (apiKey === 'mock') {
    return getNextMockQuery();
  }

  try {
    // Write buffer to a temp file for the OpenAI API
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Determine extension based on mimeType
    let ext = 'webm';
    if (mimeType.includes('wav')) ext = 'wav';
    else if (mimeType.includes('ogg')) ext = 'ogg';
    else if (mimeType.includes('mp3')) ext = 'mp3';
    else if (mimeType.includes('m4a')) ext = 'm4a';

    const tempFilePath = path.join(tempDir, `temp_audio_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    // Call OpenAI Whisper API using native fetch and FormData
    const formData = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', fileBlob, `audio.${ext}`);
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
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
      throw new Error(`Whisper API responded with status ${response.status}: ${errText}`);
    }

    const data = await response.json() as { text: string };
    return data.text || '';
  } catch (error) {
    console.error('STT Transcription error, falling back to mock:', error);
    return getNextMockQuery();
  }
}

function getNextMockQuery(): string {
  const query = mockQueries[queryIndex];
  queryIndex = (queryIndex + 1) % mockQueries.length;
  return query;
}
