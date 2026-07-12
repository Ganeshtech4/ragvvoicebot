import { test, expect } from '@playwright/test';

test('voice interaction E2E test', async ({ page }) => {
  const voiceFile = process.env.VOICE_FILE || 'speech_tech.wav';
  const isTech = voiceFile.includes('tech');
  
  console.log(`Running Voice E2E test with voiceFile: ${voiceFile} (isTech=${isTech})`);

  // Navigate to voice debug test route
  await page.goto('/voice-test');
  await page.waitForLoadState('networkidle');

  // 1. Select the profile based on the voice file being tested
  if (isTech) {
    console.log('Selecting TechSupport profile...');
    await page.click('button:has-text("TechSupport")');
  } else {
    console.log('Selecting HealthAdvice profile...');
    await page.click('button:has-text("HealthAdvice")');
  }

  // 2. Click "Connect Gateway"
  console.log('Connecting to WebSocket gateway...');
  await page.click('button:has-text("Connect Gateway")');

  // Wait for gateway connection state
  await expect(page.locator('button:has-text("Disconnect Gateway")')).toBeVisible({ timeout: 10000 });
  console.log('WebSocket connection successfully established.');

  // 3. Click the Microphone (Start) button to begin recording/streaming
  console.log('Clicking Mic to start recording...');
  await page.locator('button:has(svg.lucide-mic)').click();

  // Wait for the injected audio file to finish playing (approx 3-4 seconds)
  console.log('Streaming mock audio file...');
  await page.waitForTimeout(4000);

  // Click Stop to finish recording
  console.log('Stopping recording...');
  await page.locator('button:has(svg.lucide-square)').click();

  // 4. Wait for transcription and assistant response
  const userTranscriptBox = page.locator('#user-transcript').first();
  const assistantReplyBox = page.locator('#assistant-response').first();

  // Assert user transcript box gets populated (SpeechBrain is local, so it might take 2-4 seconds)
  console.log('Waiting for STT transcription...');
  await expect(userTranscriptBox).not.toContainText('Awaiting transcription...', { timeout: 20000 });
  const userText = await userTranscriptBox.textContent();
  console.log(`Transcribed User Speech: "${userText}"`);

  // Assert assistant reply gets populated and contains the target text
  console.log('Waiting for assistant response...');
  if (isTech) {
    await expect(assistantReplyBox).toContainText('wireguard', { timeout: 30000, ignoreCase: true });
    await expect(assistantReplyBox).toContainText('vpn', { timeout: 30000, ignoreCase: true });
  } else {
    await expect(assistantReplyBox).toContainText('flu', { timeout: 30000, ignoreCase: true });
    await expect(assistantReplyBox).toContainText('rest', { timeout: 30000, ignoreCase: true });
  }
  const assistantText = await assistantReplyBox.textContent();
  console.log(`Assistant Response: "${assistantText}"`);

  console.log('Verification successful! Grounded text matches expectation.');

  // Print latency benchmarks displayed in the UI
  console.log('\n--- LATENCY METRICS ---');
  const labels = [
    { label: 'STT (SpeechBrain)', key: 'STT' },
    { label: 'Qdrant Retrieval', key: 'Qdrant' },
    { label: 'Groq (First Token)', key: 'Groq First' },
    { label: 'TTS Synthesis', key: 'TTS' },
    { label: 'Total Response Loop', key: 'Total' }
  ];
  
  for (const item of labels) {
    try {
      const value = await page.locator(`span:has-text("${item.label}") + span`).textContent({ timeout: 2000 });
      console.log(`${item.label}: ${value?.trim()}`);
    } catch (e) {
      console.log(`Could not read latency for ${item.label}`);
    }
  }
  console.log('-----------------------\n');
});
