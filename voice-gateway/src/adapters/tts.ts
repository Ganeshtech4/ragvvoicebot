import dotenv from 'dotenv';

dotenv.config();

const provider = (process.env.TTS_PROVIDER || 'mock').toLowerCase();
const apiKey = process.env.TTS_API_KEY || process.env.OPENAI_API_KEY || 'mock';
const customUrl = process.env.TTS_API_URL || '';
const modelName = process.env.TTS_MODEL || 'tts-1';
const voiceName = process.env.TTS_VOICE || 'alloy';

/**
 * Converts text into an audio buffer using customizable TTS API configurations.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  if (provider === 'mock') {
    return generateMockVoiceWAV(text);
  }

  try {
    const url = customUrl || 'https://api.openai.com/v1/audio/speech';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        input: text,
        voice: voiceName,
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`TTS API responded with status ${response.status}: ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`TTS Synthesis error (${provider}), falling back to synthesized WAV:`, error);
    return generateMockVoiceWAV(text);
  }
}

/**
 * Generates an 8kHz 8-bit mono PCM WAV file containing modulated synth frequencies.
 * It simulates a retro robot speech pattern corresponding to the length of the text.
 */
function generateMockVoiceWAV(text: string): Buffer {
  const sampleRate = 8000;
  const durationMs = Math.min(8000, Math.max(500, text.length * 70));
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  
  const headerSize = 44;
  const dataSize = numSamples;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // Write WAV Header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Modulate frequencies to synthesize robot syllables
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const syllableIndex = Math.floor(t * 5.5);
    const freqs = [220, 262, 330, 294, 392, 440, 349];
    const baseFreq = freqs[syllableIndex % freqs.length];
    
    const vibrato = Math.sin(2 * Math.PI * 6 * t) * 8; 
    const freq = baseFreq + vibrato;
    const envelope = Math.max(0, Math.sin(2 * Math.PI * 2.75 * t));

    const sample = Math.sin(2 * Math.PI * freq * t) * 60 * envelope + 128;
    buffer.writeUInt8(Math.floor(sample), headerSize + i);
  }

  return buffer;
}
