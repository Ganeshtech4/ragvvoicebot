import dotenv from 'dotenv';

dotenv.config();

// Load LLM configuration with intelligent defaults
const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'mock';
const customUrl = process.env.LLM_API_URL || '';
const modelName = process.env.LLM_MODEL || (provider === 'gemini' ? 'gemini-2.5-flash' : provider === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o-mini');

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Streams the response from the LLM based on provider selection in environment variables.
 */
export async function streamLLMResponse(
  prompt: string,
  context: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void
): Promise<void> {
  const systemPrompt = `You are a helpful customer service assistant for our company. 
You must answer the user's question based strictly on the retrieved knowledge base context below. 
If the context does not contain the answer, politely tell the user you don't know the answer.

Retrieved Context:
${context || 'No knowledge base context found.'}`;

  if (provider === 'mock') {
    await simulateMockStreaming(prompt, context, onChunk);
    return;
  }

  try {
    if (provider === 'anthropic') {
      await streamAnthropicResponse(systemPrompt, prompt, history, onChunk);
    } else if (provider === 'gemini') {
      await streamGeminiResponse(systemPrompt, prompt, history, onChunk);
    } else {
      // Handles 'openai' and 'custom' (OpenAI-compatible) providers
      await streamOpenAICompatibleResponse(systemPrompt, prompt, history, onChunk);
    }
  } catch (error) {
    console.error(`Error calling LLM provider (${provider}), falling back to mock:`, error);
    await simulateMockStreaming(prompt, context, onChunk);
  }
}

/**
 * Streams from standard OpenAI or OpenAI-compatible (custom) gateways.
 */
async function streamOpenAICompatibleResponse(
  systemPrompt: string,
  prompt: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void
): Promise<void> {
  // Determine endpoint
  const url = customUrl || 'https://api.openai.com/v1/chat/completions';
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(msg => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: prompt }
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM provider responded with status ${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body reader is null');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned) continue;
      if (cleaned === 'data: [DONE]') continue;

      if (cleaned.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(cleaned.slice(6));
          const chunk = parsed.choices?.[0]?.delta?.content || '';
          if (chunk) {
            onChunk(chunk);
          }
        } catch (e) {
          // Ignore parsing errors of partial chunks
        }
      }
    }
  }
}

/**
 * Streams from Anthropic (Claude) API endpoint.
 */
async function streamAnthropicResponse(
  systemPrompt: string,
  prompt: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void
): Promise<void> {
  const url = customUrl || 'https://api.anthropic.com/v1/messages';

  // Anthropic messages format mapping
  const messages = [
    ...history.map(msg => ({ 
      role: msg.role === 'assistant' ? 'assistant' as const : 'user' as const, 
      content: msg.content 
    })),
    { role: 'user' as const, content: prompt }
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelName,
      system: systemPrompt,
      messages,
      stream: true,
      max_tokens: 1024
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic responded with status ${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body reader is null');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';

    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned) continue;

      if (cleaned.startsWith('event: ')) {
        currentEvent = cleaned.slice(7);
      } else if (cleaned.startsWith('data: ')) {
        try {
          const rawData = cleaned.slice(6);
          const parsed = JSON.parse(rawData);
          
          if (currentEvent === 'content_block_delta' && parsed.delta?.text) {
            onChunk(parsed.delta.text);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }
    }
  }
}

/**
 * Streams from Google Gemini API endpoint.
 */
async function streamGeminiResponse(
  systemPrompt: string,
  prompt: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void
): Promise<void> {
  // Use custom URL or default Gemini API endpoint
  // Using alt=sse parameters turns Gemini stream responses into standard event-stream text format!
  const url = customUrl || `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;

  // Map messages to Gemini API format
  const contents = [
    ...history.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    })),
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents,
      generationConfig: {
        responseMimeType: 'text/plain'
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini responded with status ${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body reader is null');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned) continue;

      if (cleaned.startsWith('data: ')) {
        try {
          const rawData = cleaned.slice(6);
          const parsed = JSON.parse(rawData);
          const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (chunk) {
            onChunk(chunk);
          }
        } catch (e) {
          // Ignore parsing errors on partial buffers
        }
      }
    }
  }
}

/**
 * Simulates a realistic typing stream using the matched RAG documents.
 */
async function simulateMockStreaming(
  prompt: string,
  context: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  let responseText = '';
  const lowerPrompt = prompt.toLowerCase();
  
  if (context) {
    if (lowerPrompt.includes('password') || lowerPrompt.includes('reset')) {
      responseText = "To reset your password, you should go to the TechSupport Portal. Click on 'Forgot Password' and check your registered email for the link. Make sure your new password is at least 12 characters long and contains both a number and a special character.";
    } else if (lowerPrompt.includes('vpn') || lowerPrompt.includes('connect')) {
      responseText = "You can configure your company VPN using Cisco Secure Client. You'll need to download it internally, point it to 'vpn.techcorp.com', and log in using your Active Directory username, password, and Duo MFA.";
    } else if (lowerPrompt.includes('printer') || lowerPrompt.includes('print')) {
      responseText = "For printer issues, try restarting the print spooler in Windows. Open an Administrator command prompt and run: 'net stop spooler' followed by 'net start spooler'. Also, verify if you can ping the printer at IP 192.168.1.150.";
    } else if (lowerPrompt.includes('flu') || lowerPrompt.includes('fever') || lowerPrompt.includes('sick')) {
      responseText = "For general flu care, please get plenty of rest and stay hydrated by drinking water or clear broths. Ibuprofen or acetaminophen can help with fever and aches. If you have any difficulty breathing, seek emergency medical care immediately.";
    } else if (lowerPrompt.includes('cancel') || lowerPrompt.includes('appointment')) {
      responseText = "Our cancellation policy requires you to cancel at least 24 hours prior to your appointment to avoid a $25 late cancellation fee. You can cancel through our online patient portal or by calling our service line directly.";
    } else if (lowerPrompt.includes('diet') || lowerPrompt.includes('eat') || lowerPrompt.includes('food')) {
      responseText = "For a healthy diet, we suggest focusing on whole grains, vegetables, fresh fruits, lean proteins, and healthy fats. Remember to limit processed foods, added sugars, and saturated fats, and aim to drink at least 8 glasses of water a day.";
    } else {
      responseText = `Based on your company documents: \n\n${context}\n\nIs there anything specific I can help clarify?`;
    }
  } else {
    responseText = "Hello! I am your AI assistant. I couldn't find any specific documents relating to your query in your tenant's knowledge base. Please let me know how I can help you, or ask about password resets, VPN, printers, flu care, or appointments.";
  }

  const words = responseText.split(' ');
  for (const word of words) {
    onChunk(word + ' ');
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}
