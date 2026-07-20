import { auth } from "@/app/(auth)/auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return Response.json({ error: "chatId required" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(`http://docubot-backend:5001/api/v1/messages/${chatId}`, {
      headers: {
        "Authorization": `Bearer ${session.user.accessToken}`,
      },
    });

    if (!response.ok) {
      return Response.json({ error: "Failed to fetch messages" }, { status: response.status });
    }

    const messages = await response.json();
    const uiMessages = messages.map((m: any, idx: number) => ({
      id: `${chatId}-${idx}`,
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
      parts: [{ type: "text", text: m.text }],
      createdAt: new Date(m.created_at || Date.now()),
    }));

    return Response.json({
      isReadonly: false,
      messages: uiMessages,
      userId: session.user.id,
      visibility: "private",
    });
  } catch (error: any) {
    console.error("Error loading messages:", error);
    return Response.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
