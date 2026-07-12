'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Send, User, LogOut, MessageSquare, Bot, Key, FileText, Database, Volume2 } from 'lucide-react';
import VoiceInterface from '../components/VoiceInterface';

interface Message {
  sender: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

interface UserSessionInfo {
  userId: string;
  username: string;
  tenantId: string;
  tenantName: string;
  accessToken: string;
}

export default function Dashboard() {
  // Authentication & Tenant State
  const [userInfo, setUserInfo] = useState<UserSessionInfo | null>(null);
  const [loginUsername, setLoginUsername] = useState('techuser');
  const [loginPassword, setLoginPassword] = useState('password123');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Load user session from localStorage if present
  useEffect(() => {
    const savedUser = localStorage.getItem('user_session');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        const normalized: UserSessionInfo = {
          userId: parsed.userId,
          username: parsed.username,
          tenantId: parsed.tenantId,
          tenantName: parsed.tenantName,
          accessToken: parsed.accessToken || parsed.access_token,
        };
        setUserInfo(normalized);
      } catch (e) {
        localStorage.removeItem('user_session');
      }
    }
  }, []);

  // Fetch recent user sessions when logged in
  useEffect(() => {
    if (userInfo) {
      fetchUserSessions();
      // Initialize with fresh conversation
      setMessages([]);
      setSessionId(null);
    }
  }, [userInfo]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchUserSessions = async () => {
    if (!userInfo) return;
    try {
      const res = await fetch(`/api/v1/sessions/${userInfo.userId}`, {
        headers: {
          'Authorization': `Bearer ${userInfo.accessToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSessionsList(data);
      }
    } catch (e) {
      console.error('Failed to fetch session list:', e);
    }
  };

  const loadSessionMessages = async (id: string) => {
    if (!userInfo) return;
    try {
      const res = await fetch(`/api/v1/messages/${id}`, {
        headers: {
          'Authorization': `Bearer ${userInfo.accessToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(id);
        setMessages(data.map((msg: any) => ({
          sender: msg.sender,
          text: msg.text
        })));
      }
    } catch (e) {
      console.error('Failed to load session messages:', e);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setLoadingAuth(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Login failed');
      }

      const rawData = await res.json();
      const normalizedData: UserSessionInfo = {
        userId: rawData.userId,
        username: rawData.username,
        tenantId: rawData.tenantId,
        tenantName: rawData.tenantName,
        accessToken: rawData.accessToken || rawData.access_token,
      };
      setUserInfo(normalizedData);
      localStorage.setItem('user_session', JSON.stringify(normalizedData));
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('user_session');
    setUserInfo(null);
    setMessages([]);
    setSessionId(null);
    setSessionsList([]);
  };

  // --- TEXT INTERACTION LOGIC (HTTP STREAMING) ---

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !userInfo) return;

    const userText = inputText;
    setInputText('');

    // Append user message
    setMessages(prev => [...prev, { sender: 'user', text: userText }]);

    // Add placeholder assistant message for streaming
    setMessages(prev => [...prev, { sender: 'assistant', text: '', isStreaming: true }]);

    try {
      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userInfo.accessToken}`
        },
        body: JSON.stringify({
          message: userText,
          tenantId: userInfo.tenantId,
          userId: userInfo.userId,
          sessionId: sessionId || undefined
        })
      });

      if (!res.ok) {
        throw new Error('Chat API returned an error');
      }

      // Check for session ID headers
      const returnedSessionId = res.headers.get('X-Session-ID');
      if (returnedSessionId && !sessionId) {
        setSessionId(returnedSessionId);
        fetchUserSessions();
      }

      // Stream text response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Stream reader undefined');

      const decoder = new TextDecoder();
      let streamedAnswer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const textChunk = decoder.decode(value, { stream: true });
        streamedAnswer += textChunk;

        setMessages(prev => {
          const updated = [...prev];
          const streamIdx = updated.findIndex(m => m.isStreaming);
          if (streamIdx !== -1) {
            updated[streamIdx] = {
              sender: 'assistant',
              text: streamedAnswer,
              isStreaming: true
            };
          }
          return updated;
        });
      }

      // Finalize message state
      setMessages(prev => {
        const updated = [...prev];
        const streamIdx = updated.findIndex(m => m.isStreaming);
        if (streamIdx !== -1) {
          updated[streamIdx] = {
            sender: 'assistant',
            text: streamedAnswer
          };
        }
        return updated;
      });

    } catch (e) {
      console.error('Chat error:', e);
      setMessages(prev => {
        const updated = [...prev].filter(m => !m.isStreaming || m.text !== '');
        updated.push({
          sender: 'assistant',
          text: 'Sorry, I encountered an error communicating with the chat service.'
        });
        return updated;
      });
    }
  };

  const playMessageTTS = async (text: string) => {
    if (!userInfo) return;
    try {
      const res = await fetch('/api/v1/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userInfo.accessToken}`
        },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        throw new Error('TTS request failed');
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      await audio.play();
    } catch (e) {
      console.error('Failed to play TTS audio:', e);
    }
  };

  // --- VOICE INTERACTION EVENTS HANDLERS ---

  const handleVoiceUserTranscript = (text: string) => {
    // When the user speaks, add their transcript to the chat panel
    setMessages(prev => [...prev, { sender: 'user', text }]);
    // Prepare placeholders for the assistant response
    setMessages(prev => [...prev, { sender: 'assistant', text: '', isStreaming: true }]);
  };

  const handleVoiceAssistantTranscript = (text: string, isFinal: boolean) => {
    // Append or update streaming chunks received from voice gateway
    setMessages(prev => {
      const updated = [...prev];
      const streamIdx = updated.findIndex(m => m.isStreaming);
      
      if (streamIdx !== -1) {
        const currentText = updated[streamIdx].text;
        updated[streamIdx] = {
          sender: 'assistant',
          text: currentText + text,
          isStreaming: !isFinal
        };
      } else if (text) {
        // If no active streaming message found, create new one
        updated.push({
          sender: 'assistant',
          text,
          isStreaming: !isFinal
        });
      }
      return updated;
    });

    if (isFinal) {
      fetchUserSessions();
    }
  };

  const handleVoiceSessionCreated = (newSessionId: string) => {
    setSessionId(newSessionId);
    fetchUserSessions();
  };

  // --- RENDERING LOGIN PANEL ---

  if (!userInfo) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-100">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/5  rounded-full blur-3xl pointer-events-none" />

          {/* Heading */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-sky-400 to-emerald-400 bg-clip-text text-transparent">
              Voice RAG Bot
            </h1>
            <p className="text-sm text-slate-400 mt-2">
              Multi-Tenant Chatbot Login Gateway
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Quick selectors to demonstrate tenant isolation */}
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-2">
                Demonstration Accounts
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLoginUsername('techuser');
                    setLoginPassword('password123');
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    loginUsername === 'techuser'
                      ? 'border-sky-500 bg-sky-950/40 text-sky-300'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-900 text-slate-400'
                  }`}
                >
                  TechSupport Corp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginUsername('healthuser');
                    setLoginPassword('password123');
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    loginUsername === 'healthuser'
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-900 text-slate-400'
                  }`}
                >
                  HealthAdvice Inc
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">Username</label>
                <div className="relative">
                  <User size={16} className="absolute left-3.5 top-3 text-slate-500" />
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1.5">Password</label>
                <div className="relative">
                  <Key size={16} className="absolute left-3.5 top-3 text-slate-500" />
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm"
                  />
                </div>
              </div>
            </div>

            {authError && (
              <div className="bg-rose-950/30 border border-rose-900 text-rose-300 px-3.5 py-2.5 rounded-xl text-xs text-center">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={loadingAuth}
              className="w-full py-3 bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 text-white font-bold rounded-xl text-sm transition-all shadow-lg hover:shadow-sky-500/10 focus:outline-none disabled:bg-slate-800"
            >
              {loadingAuth ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // --- RENDERING CHATBOARD DASHBOARD ---

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-900 bg-slate-900/40 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Bot size={20} className="text-sky-400" />
          </div>
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-sky-400 to-emerald-400 bg-clip-text text-transparent">
              Voice-RAG Gateway
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tenant Context:</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-950/40 border border-sky-800/40 text-sky-400 flex items-center gap-1">
                <Database size={10} /> {userInfo.tenantName}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-400 font-semibold">{userInfo.username}</span>
          </div>
          
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900 hover:bg-slate-850 text-xs font-semibold text-rose-400 hover:text-rose-300 transition-all cursor-pointer"
          >
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* Left Sidebar: Session History */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-900 bg-slate-950 flex flex-col p-4 shrink-0">
          <button
            onClick={() => {
              setMessages([]);
              setSessionId(null);
            }}
            className="w-full py-2.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900 hover:bg-slate-850 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer mb-4"
          >
            <MessageSquare size={14} /> New Conversation
          </button>

          <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-2 px-1">
            Recent Conversations
          </label>
          
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {sessionsList.length === 0 ? (
              <span className="text-xs text-slate-600 block px-2 italic mt-2">No history found</span>
            ) : (
              sessionsList.map((sess) => (
                <button
                  key={sess.id}
                  onClick={() => loadSessionMessages(sess.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all truncate block ${
                    sessionId === sess.id
                      ? 'bg-sky-950/40 border border-sky-800/40 text-sky-300'
                      : 'hover:bg-slate-900 text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText size={12} className="shrink-0 text-slate-500" />
                    <span className="truncate">{new Date(sess.created_at).toLocaleString()}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Center: Conversation Stream */}
        <section className="flex-1 flex flex-col bg-slate-900/10 min-w-0">
          
          {/* Scrollable messages panel */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
                <Bot size={40} className="text-slate-700 mb-3" />
                <h3 className="text-sm font-bold text-slate-400">Welcome to your Multi-Tenant Agent</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Ask me about the policies and documentation of <strong className="text-sky-400">{userInfo.tenantName}</strong>. 
                  All RAG retrieval queries are securely restricted to this tenant.
                </p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 max-w-3xl ${
                    msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center border text-xs font-bold ${
                      msg.sender === 'user'
                        ? 'bg-sky-500/10 border-sky-500/20 text-sky-400'
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {msg.sender === 'user' ? 'U' : 'AI'}
                  </div>

                  {/* Bubble */}
                  <div className="flex flex-col gap-1.5">
                    {(() => {
                      const rawText = msg.text || '';
                      const marker = "[LATENCY_METRICS]:";
                      const index = rawText.indexOf(marker);
                      
                      let cleanText = rawText;
                      let metrics: any = null;
                      
                      if (index !== -1) {
                        cleanText = rawText.substring(0, index).trim();
                        const metricsJson = rawText.substring(index + marker.length).trim();
                        try {
                          metrics = JSON.parse(metricsJson);
                        } catch (e) {}
                      }

                      return (
                        <>
                          <div
                            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                              msg.sender === 'user'
                                ? 'bg-sky-600/90 text-white rounded-tr-none'
                                : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-md'
                            }`}
                          >
                            {cleanText || (
                              <span className="flex items-center gap-1 text-slate-500 text-xs italic">
                                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" />
                                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                                <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                              </span>
                            )}
                          </div>

                          {metrics && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-500 px-1 font-mono">
                              <span>Qdrant: <strong className="text-emerald-400">{metrics.qdrant_ms}ms</strong></span>
                              <span className="text-slate-800">|</span>
                              <span>Groq (First Token): <strong className="text-sky-400">{metrics.groq_first_token_ms}ms</strong></span>
                              <span className="text-slate-800">|</span>
                              <span>Groq (Total): <strong className="text-sky-400">{metrics.groq_total_ms}ms</strong></span>
                            </div>
                          )}

                          {msg.sender === 'assistant' && msg.text && (
                            <button
                              onClick={() => playMessageTTS(cleanText)}
                              className="self-start mt-0.5 flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900 hover:bg-slate-850 text-[10px] font-semibold text-sky-400 hover:text-sky-300 transition-all cursor-pointer"
                              title="Read message aloud"
                            >
                              <Volume2 size={12} /> Speak
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Text Input Panel */}
          <form onSubmit={handleSendMessage} className="p-4 bg-slate-950/40 border-t border-slate-900">
            <div className="relative flex items-center max-w-3xl mx-auto bg-slate-950 border border-slate-800 rounded-xl overflow-hidden focus-within:border-sky-500 transition-colors">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Ask ${userInfo.tenantName} database...`}
                className="flex-1 px-4 py-3 bg-transparent text-slate-200 placeholder-slate-600 focus:outline-none text-sm"
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-xs mr-1.5 transition-colors cursor-pointer disabled:bg-slate-800 disabled:text-slate-600"
              >
                <Send size={14} />
              </button>
            </div>
          </form>
        </section>

        {/* Right Sidebar: Voice Interface */}
        <section className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-900 bg-slate-950/20 p-6 flex flex-col justify-center shrink-0">
          <div className="text-center mb-4">
            <h3 className="text-xs uppercase font-bold tracking-wider text-slate-500">Voice Control Hub</h3>
            <p className="text-[10px] text-slate-500 mt-1">Talk naturally with barge-in support</p>
          </div>
          
          {userInfo && (
            <VoiceInterface
              tenantId={userInfo.tenantId}
              userId={userInfo.userId}
              token={userInfo.accessToken}
              sessionId={sessionId}
              onSessionCreated={handleVoiceSessionCreated}
              onUserText={handleVoiceUserTranscript}
              onAssistantText={handleVoiceAssistantTranscript}
            />
          )}
        </section>

      </div>
    </main>
  );
}
