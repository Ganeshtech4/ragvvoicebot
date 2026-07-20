import { auth } from "@/app/(auth)/auth";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.accessToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();

    // The AI SDK transport sends either:
    //   { messages: [...], id } — for tool-approval continuations
    //   { message: {...}, id }  — for normal user messages
    // Normalise both shapes into a consistent `messages` array.
    const id = body.id;
    const messages: any[] = Array.isArray(body.messages)
      ? body.messages
      : body.message
      ? [body.message]
      : [];

    const lastMessage = messages.at(-1);

    if (!lastMessage || lastMessage.role !== "user") {
      return new Response("Bad Request", { status: 400 });
    }

    // Extract the text from parts[] (AI SDK format) or fall back to content string
    const promptText: string =
      (Array.isArray(lastMessage.parts)
        ? lastMessage.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text ?? "")
            .join("")
        : "") ||
      (typeof lastMessage.content === "string" ? lastMessage.content : "") ||
      "";

    if (!promptText.trim()) {
      return new Response("Bad Request: message text is empty", { status: 400 });
    }

    // Call our FastAPI backend
    const response = await fetch("http://docubot-backend:5001/api/v1/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.user.accessToken}`,
      },
      body: JSON.stringify({
        message: promptText,
        sessionId: id || null,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      // Return proper JSON so the client doesn't show a "not valid JSON" error
      return Response.json(
        { error: errText || "Backend error" },
        { status: response.status }
      );
    }

    const messageId = `msg-${Date.now()}`;

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Check if buffer contains latency metrics
          if (buffer.includes("[LATENCY_METRICS]:")) {
            const index = buffer.indexOf("[LATENCY_METRICS]:");
            const textPart = buffer.substring(0, index);
            if (textPart) {
              writer.write({
                type: "text-delta",
                id: messageId,
                delta: textPart,
              });
            }
            
            try {
              const metricsStr = buffer.substring(index + "[LATENCY_METRICS]:".length);
              const metrics = JSON.parse(metricsStr.trim());
              writer.write({
                type: "custom",
                kind: "metrics.latency",
                value: { type: "latency", stats: metrics }
              } as any);
            } catch (e) {
              // ignore parse errors
            }
            buffer = "";
          } else {
            // Write normal text chunks to the stream
            writer.write({
              type: "text-delta",
              id: messageId,
              delta: chunk,
            });
          }
        }
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error: any) {
    console.error("Error in Next.js chat API:", error);
    return Response.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
