'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Wifi, WifiOff, RefreshCw, Play, Square, ArrowLeft, Clock, BarChart3, Database, Upload } from 'lucide-react';
import Link from 'next/link';
import { AudioQueue } from '../../lib/audioQueue';

type Profile = 'tech' | 'health';
type Status = 'idle' | 'connecting' | 'connected' | 'listening' | 'processing' | 'speaking';

interface LatencyStats {
  stt_ms?: number;
  qdrant_ms?: number;
  groq_first_token_ms?: number;
  groq_total_ms?: number;
  tts_ms?: number;
  total_ms?: number;
}

export default function VoiceTestPage() {
  const [profile, setProfile] = useState<Profile>('tech');
  const [status, setStatus] = useState<Status>('idle');
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantResponse, setAssistantResponse] = useState('');
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  
  const isRecordingRef = useRef(false);

  // Setup Audio Queue
  useEffect(() => {
    audioQueueRef.current = new AudioQueue();
    addLog('INFO: Audio Queue initialized.');
    return () => {
      audioQueueRef.current?.interrupt();
      disconnectWebSocket();
    };
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${time}] ${msg}`]);
  };

  const connectWebSocket = () => {
    disconnectWebSocket();
    setStatus('connecting');
    setErrorMsg(null);
    setLatency(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:5002' : window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/ws`;

    addLog(`CONNECTING: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setStatus('connected');
      addLog('CONNECTED: Handshake established.');
      
      const token = profile === 'tech' ? 'mock-tech' : 'mock-health';
      ws.send(JSON.stringify({
        type: 'start',
        token,
        sessionId: null
      }));
      addLog(`SENT: start event with token="${token}"`);
    };

    ws.onmessage = (event) => {
      try {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          addLog(`RECEIVED JSON: ${message.type} ${message.status || ''}`);

          switch (message.type) {
            case 'status':
              if (message.status === 'ready') {
                setStatus(isRecordingRef.current ? 'listening' : 'connected');
              } else if (message.status === 'processing') {
                setStatus('processing');
              } else if (message.status === 'playing') {
                setStatus('speaking');
              }
              break;

            case 'transcript':
              if (message.sender === 'user') {
                setUserTranscript(message.text);
                addLog(`USER FINAL TRANSCRIPT: "${message.text}"`);
              } else {
                if (message.isFinal) {
                  addLog('ASSISTANT STREAM FINALIZED.');
                } else {
                  setAssistantResponse(prev => prev + message.text);
                }
              }
              break;

            case 'audio':
              audioQueueRef.current?.enqueueBase64(message.data);
              break;

            case 'latency':
              setLatency(message.stats);
              addLog(`LATENCY METRICS RECEIVED: ${JSON.stringify(message.stats)}`);
              break;

            case 'error':
              setErrorMsg(message.message);
              addLog(`ERROR: ${message.message}`);
              break;
          }
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = (e) => {
      addLog('ERROR: WebSocket error occurred.');
      setConnected(false);
      setStatus('idle');
      setErrorMsg('Connection error. Please try again.');
    };

    ws.onclose = () => {
      setConnected(false);
      setStatus('idle');
      addLog('DISCONNECTED: WebSocket closed.');
    };
  };

  const disconnectWebSocket = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnected(false);
    setStatus('idle');
  };

  const startRecording = async () => {
    audioQueueRef.current?.interrupt();
    setAssistantResponse('');
    setUserTranscript('');
    setLatency(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }

    try {
      addLog('MICROPHONE: Requesting permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      isRecordingRef.current = true;
      setStatus('listening');
      addLog('MICROPHONE: Permission granted. Recording started.');

      let options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: '' };
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(event.data);
        }
      };

      mediaRecorder.start(200);
      addLog('STREAMING: Sending 200ms audio chunks...');
    } catch (err) {
      addLog(`MICROPHONE ERROR: ${err}`);
      setErrorMsg('Microphone permission denied.');
      setStatus('connected');
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    addLog('STOPPING: Finalizing audio stream.');

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'stop' }));
      addLog('SENT: stop event.');
    }
    setStatus('processing');
  };

  const handleInterrupt = () => {
    audioQueueRef.current?.interrupt();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
      addLog('SENT: interrupt event.');
    }
    setStatus('connected');
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    audioQueueRef.current?.interrupt();
    setAssistantResponse('');
    setUserTranscript('');
    setLatency(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }

    addLog(`FILE UPLOAD: Selected file '${file.name}' (${file.size} bytes).`);
    setStatus('processing');

    try {
      const arrayBuffer = await file.arrayBuffer();
      
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        // Send the file in 16KB chunks to avoid socket buffer congestion
        const chunkSize = 16384;
        let offset = 0;
        addLog('FILE UPLOAD: Streaming file chunks to gateway...');
        
        while (offset < arrayBuffer.byteLength) {
          const chunk = arrayBuffer.slice(offset, offset + chunkSize);
          socketRef.current.send(chunk);
          offset += chunkSize;
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        socketRef.current.send(JSON.stringify({ type: 'stop' }));
        addLog('FILE UPLOAD: Finished uploading file. Sent stop event.');
      } else {
        addLog('FILE UPLOAD ERROR: WebSocket is not open.');
        setStatus('connected');
      }
    } catch (err: any) {
      addLog(`FILE UPLOAD ERROR: ${err.message || err}`);
      setStatus('connected');
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        {/* Navigation / Header */}
        <header className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 transition-colors">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-sky-400 to-emerald-400 bg-clip-text text-transparent">
                Voice Layer Debug Tool
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">Isolated testing and benchmarking panel</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {connected ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 px-3 py-1 rounded-full">
                <Wifi size={14} /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 bg-rose-950/40 border border-rose-900/60 px-3 py-1 rounded-full">
                <WifiOff size={14} /> Disconnected
              </span>
            )}
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Column 1: Test Presets & Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-6 shadow-xl">
            <div>
              <h2 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">1. Select Preset Profile</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (connected) disconnectWebSocket();
                    setProfile('tech');
                  }}
                  className={`flex-1 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    profile === 'tech'
                      ? 'border-sky-500 bg-sky-950/40 text-sky-400'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400'
                  }`}
                >
                  <Database size={13} /> TechSupport
                </button>
                <button
                  onClick={() => {
                    if (connected) disconnectWebSocket();
                    setProfile('health');
                  }}
                  className={`flex-1 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    profile === 'health'
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-400'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400'
                  }`}
                >
                  <Database size={13} /> HealthAdvice
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">2. Connection</h2>
              {connected ? (
                <button
                  onClick={disconnectWebSocket}
                  className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <WifiOff size={14} /> Disconnect Gateway
                </button>
              ) : (
                <button
                  onClick={connectWebSocket}
                  className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <Wifi size={14} /> Connect Gateway
                </button>
              )}
            </div>

            <div className="flex-1 flex flex-col justify-center items-center py-4 border-t border-slate-800/80">
              <h2 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">3. Voice Capture</h2>
              <div className="flex flex-col items-center gap-3">
                {status === 'listening' ? (
                  <button
                    onClick={stopRecording}
                    className="w-20 h-20 bg-rose-600 border border-rose-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-rose-600/30 transition-transform active:scale-95 animate-pulse"
                  >
                    <Square size={28} />
                  </button>
                ) : (
                  <button
                    onClick={startRecording}
                    disabled={!connected}
                    className="w-20 h-20 bg-sky-600 border border-sky-500 hover:bg-sky-500 disabled:bg-slate-850 disabled:border-slate-800 disabled:text-slate-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-sky-600/20 transition-transform active:scale-95 cursor-pointer"
                  >
                    <Mic size={32} />
                  </button>
                )}
                
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-1">
                  Status: <span className="text-sky-400">{status}</span>
                </span>

                {(status === 'speaking' || status === 'processing') && (
                  <button
                    onClick={handleInterrupt}
                    className="mt-2 px-3.5 py-1.5 border border-slate-700 bg-slate-950 hover:bg-slate-900 rounded-lg text-rose-400 hover:text-rose-300 text-xs font-bold transition-colors"
                  >
                    Interrupt Assistant
                  </button>
                )}

                <div className="w-full mt-4 pt-4 border-t border-slate-800/60 flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Or Upload Audio File</span>
                  <label className={`w-full py-2 border rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    connected
                      ? 'border-slate-800 hover:border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'
                      : 'border-slate-900 bg-slate-950/40 text-slate-650 cursor-not-allowed'
                  }`}>
                    <Upload size={13} />
                    <span>Choose File</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleAudioUpload}
                      disabled={!connected}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
            
            {errorMsg && (
              <div className="bg-rose-950/40 border border-rose-900 text-rose-300 px-3 py-2.5 rounded-xl text-xs text-center">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Column 2: Transcripts & Response Panels */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* User Transcript Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">User Speech (STT Transcript)</h2>
              <div id="user-transcript" className="min-h-12 bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-sm text-sky-200 italic">
                {userTranscript || 'Awaiting transcription...'}
              </div>
            </div>

            {/* Assistant Response Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex-1 flex flex-col">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Assistant Grounded Reply</h2>
              <div id="assistant-response" className="flex-1 min-h-36 bg-slate-950 border border-slate-800/80 rounded-xl p-4 text-sm text-slate-200 leading-relaxed font-mono overflow-y-auto">
                {assistantResponse || 'Awaiting response from LLM...'}
              </div>
            </div>
          </div>
        </div>

        {/* Latency & Metrics Graph */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h2 className="text-sm font-bold text-slate-400 mb-4 flex items-center gap-1.5 uppercase tracking-wider">
              <BarChart3 size={16} className="text-sky-400" /> Latency Benchmarks
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-500">STT (SpeechBrain)</span>
                <span className="text-lg font-bold text-slate-200 mt-1">
                  {latency?.stt_ms ? `${latency.stt_ms} ms` : '--'}
                </span>
                <span className="text-[9px] text-slate-500 mt-1">Target: &lt;1000ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-500">Qdrant Retrieval</span>
                <span className="text-lg font-bold text-slate-200 mt-1">
                  {latency?.qdrant_ms ? `${latency.qdrant_ms} ms` : '--'}
                </span>
                <span className="text-[9px] text-slate-500 mt-1">Target: &lt;100ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-500">Groq (First Token)</span>
                <span className="text-lg font-bold text-slate-200 mt-1">
                  {latency?.groq_first_token_ms ? `${latency.groq_first_token_ms} ms` : '--'}
                </span>
                <span className="text-[9px] text-slate-500 mt-1">Target: &lt;1000ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-500">Groq (Total Stream)</span>
                <span className="text-lg font-bold text-slate-200 mt-1">
                  {latency?.groq_total_ms ? `${latency.groq_total_ms} ms` : '--'}
                </span>
                <span className="text-[9px] text-slate-500 mt-1">LLM response completion</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-500">TTS Synthesis</span>
                <span className="text-lg font-bold text-slate-200 mt-1">
                  {latency?.tts_ms ? `${latency.tts_ms} ms` : '--'}
                </span>
                <span className="text-[9px] text-slate-500 mt-1">Target: &lt;500ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex flex-col justify-between border-sky-900/50 bg-sky-950/10">
                <span className="text-[10px] uppercase font-bold text-sky-400">Total Response Loop</span>
                <span className="text-lg font-bold text-sky-300 mt-1">
                  {latency?.total_ms ? `${latency.total_ms} ms` : '--'}
                </span>
                <span className="text-[9px] text-sky-500 mt-1">Target: &lt;3000ms</span>
              </div>
            </div>
          </div>

          {/* Event Logger console */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
            <h2 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-1.5 uppercase tracking-wider">
              <Clock size={16} className="text-emerald-400" /> Event Monitor
            </h2>
            <div className="flex-1 h-44 bg-slate-950 border border-slate-800/80 rounded-xl p-3 font-mono text-[10px] text-emerald-400/90 overflow-y-auto space-y-1">
              {logs.map((log, idx) => (
                <div key={idx}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
