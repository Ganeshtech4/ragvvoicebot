import { auth } from "@/app/(auth)/auth";

export async function GET() {
  const session = await auth();

  if (!session?.user?.accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const response = await fetch(`http://docubot-backend:5001/api/v1/sessions/${session.user.id}`, {
      headers: {
        "Authorization": `Bearer ${session.user.accessToken}`,
      },
    });

    if (!response.ok) {
      return new Response(await response.text(), { status: response.status });
    }

    const sessions = await response.json();
    const chats = sessions.map((s: any) => ({
      id: s.id,
      title: `Chat Session`,
      createdAt: new Date(s.created_at || Date.now()),
      userId: session.user.id,
      path: `/chat/${s.id}`,
    }));

    return Response.json({
      chats,
      hasMore: false,
    });
  } catch (error: any) {
    console.error("Error fetching history:", error);
    return new Response(error.message || "Internal Server Error", { status: 500 });
  }
}

export async function DELETE() {
  // Not implemented, but return empty success
  return Response.json({ success: true }, { status: 200 });
}
