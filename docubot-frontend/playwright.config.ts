import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Resolve target voice file from environment variable, defaulting to speech_tech.wav in project root
const voiceFile = process.env.VOICE_FILE 
  ? path.resolve(__dirname, '..', process.env.VOICE_FILE)
  : path.resolve(__dirname, '..', 'speech_tech.wav');

console.log(`Using voice file for mock audio input: ${voiceFile}`);

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'on',
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${voiceFile}`
      ]
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ]
});
