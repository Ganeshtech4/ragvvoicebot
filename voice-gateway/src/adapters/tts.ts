import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY || 'mock';

/**
 * Converts text into an audio buffer (MP3 or WAV).
 * @param text The input text to convert
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  if (apiKey === 'mock') {
    return generateMockVoiceWAV(text);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'alloy',
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
    console.error('TTS Synthesis error, falling back to synthesized WAV:', error);
    return generateMockVoiceWAV(text);
  }
}

/**
 * Generates an 8kHz 8-bit mono PCM WAV file containing modulated synth frequencies.
 * It simulates a retro robot speech pattern corresponding to the length of the text.
 */
function generateMockVoiceWAV(text: string): Buffer {
  const sampleRate = 8000;
  
  // Calculate duration based on character count: ~70ms per character, min 0.5s, max 8s
  const durationMs = Math.min(8000, Math.max(500, text.length * 70));
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  
  const headerSize = 44;
  const dataSize = numSamples;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // Write WAV Header
  buffer.write('RIFF', 0);                              // ChunkID
  buffer.writeUInt32LE(36 + dataSize, 4);                // ChunkSize
  buffer.write('WAVE', 8);                              // Format
  buffer.write('fmt ', 12);                             // Subchunk1ID
  buffer.writeUInt32LE(16, 16);                         // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);                          // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22);                          // NumChannels (1 for Mono)
  buffer.writeUInt32LE(sampleRate, 24);                  // SampleRate (8000)
  buffer.writeUInt32LE(sampleRate, 28);                  // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(1, 32);                          // BlockAlign (NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(8, 34);                          // BitsPerSample (8)
  buffer.write('data', 36);                             // Subchunk2ID
  buffer.writeUInt32LE(dataSize, 40);                   // Subchunk2Size

  // Write Modulated Sine Wave Samples (simulating a cute robot speaking syllables)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate; // time in seconds
    
    // Create voice pitch modulation: simulate words/syllables by switching base frequency
    const syllableIndex = Math.floor(t * 5.5); // 5.5 syllables per second
    const freqs = [220, 262, 330, 294, 392, 440, 349];
    const baseFreq = freqs[syllableIndex % freqs.length];
    
    // Add frequency modulation (vibrato)
    const vibrato = Math.sin(2 * Math.PI * 6 * t) * 8; 
    const freq = baseFreq + vibrato;

    // Amplitude envelope to create gaps between syllables
    const envelope = Math.max(0, Math.sin(2 * Math.PI * 2.75 * t));

    // Synthesis formula
    const sample = Math.sin(2 * Math.PI * freq * t) * 60 * envelope + 128;
    
    buffer.writeUInt8(Math.floor(sample), headerSize + i);
  }

  return buffer;
}
