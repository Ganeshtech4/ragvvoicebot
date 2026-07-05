import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY || 'mock';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Streams the response from the LLM or mock generator.
 * @param prompt The user's input query
 * @param context The retrieved RAG context
 * @param history Recent conversation messages
 * @param onChunk Callback to execute for every text chunk
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

  // If mock mode or API key not set, generate mock response based on RAG context
  if (apiKey === 'mock') {
    await simulateMockStreaming(prompt, context, onChunk);
    return;
  }

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(msg => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: prompt }
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API responded with status ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body reader is null');
    }

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
            // Ignore parse errors on partial streams
          }
        }
      }
    }
  } catch (error) {
    console.error('Error calling OpenAI API, falling back to mock:', error);
    await simulateMockStreaming(prompt, context, onChunk);
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
      // General fallback based on RAG context
      responseText = `Based on your company documents: \n\n${context}\n\nIs there anything specific I can help clarify?`;
    }
  } else {
    responseText = "Hello! I am your AI assistant. I couldn't find any specific documents relating to your query in your tenant's knowledge base. Please let me know how I can help you, or ask about password resets, VPN, printers, flu care, or appointments.";
  }

  // Stream text character-by-character or word-by-word with delay
  const words = responseText.split(' ');
  for (const word of words) {
    onChunk(word + ' ');
    await new Promise(resolve => setTimeout(resolve, 60)); // typing speed simulation
  }
}
