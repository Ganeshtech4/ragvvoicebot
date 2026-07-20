'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, X, Plus, Volume2, Loader2, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { AudioQueue } from '../lib/audioQueue';

interface VoiceInterfaceProps {
  tenantId: string;
  userId: string;
  token: string;
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onAssistantText: (text: string, isFinal: boolean) => void;
  onUserText: (text: string) => void;
  onClose: () => void;
}

type Mode = 'ptt' | 'handsfree';
type Status = 'idle' | 'listening' | 'processing' | 'speaking';

export default function VoiceInterface({
  tenantId,
  userId,
  token,
  sessionId,
  onSessionCreated,
  onAssistantText,
  onUserText,
  onClose,
}: VoiceInterfaceProps) {
  const [mode, setMode] = useState<Mode>('handsfree'); // default to hands-free for ChatGPT feel
  const [status, setStatus] = useState<Status>('idle');
  const [connected, setConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);

  // Web Audio refs for VAD (Voice Activity Detection) and visualizer
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const orbGlowRef = useRef<HTMLDivElement>(null);

  // Hands-free state management refs
  const isRecordingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const lastVolumeRef = useRef<number>(0);

  // Setup Audio Queue
  useEffect(() => {
    audioQueueRef.current = new AudioQueue();
    return () => {
      audioQueueRef.current?.interrupt();
    };
  }, []);

  // Manage WebSocket connection
  useEffect(() => {
    connectWebSocket();
    return () => {
      disconnectWebSocket();
    };
  }, [tenantId, userId, token]);

  // Animation Loop for Pulsing Orb
  useEffect(() => {
    let active = true;

    const updateOrb = () => {
      if (!active) return;
      animationFrameRef.current = requestAnimationFrame(updateOrb);

      let currentVolume = 0;

      // 1. Get volume from user's microphone if currently recording
      if (isRecordingRef.current && analyserRef.current && !isMuted) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        currentVolume = Math.sqrt(sum / dataArray.length);
        lastVolumeRef.current = currentVolume;
      } 
      // 2. Get volume from assistant's playing speech
      else if (status === 'speaking' && audioQueueRef.current) {
        currentVolume = audioQueueRef.current.getVolumeLevel();
      }

      // 3. Apply smooth scaling to the orb and glow elements
      if (orbRef.current && orbGlowRef.current) {
        // Base pulse using sine wave for organic feel
        const basePulse = 1 + 0.04 * Math.sin(Date.now() / 250);
        
        // Add dynamic volume scaling (sensitive to changes)
        const volumeScale = currentVolume * 2.8; 
        const totalScale = basePulse + volumeScale;

        orbRef.current.style.transform = `scale(${totalScale})`;
        
        // Dynamic glow size and opacity
        const glowScale = totalScale * 1.15;
        const glowOpacity = Math.min(0.85, 0.4 + currentVolume * 1.5);
        orbGlowRef.current.style.transform = `scale(${glowScale})`;
        orbGlowRef.current.style.opacity = `${glowOpacity}`;
      }
    };

    updateOrb();

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [status, isMuted]);

  const connectWebSocket = () => {
    disconnectWebSocket();
    setErrorMsg(null);

    let activeToken = token;
    if (!activeToken && typeof window !== 'undefined') {
      const saved = localStorage.getItem('user_session');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          activeToken = parsed.accessToken;
        } catch (e) {}
      }
    }

    if (!activeToken) {
      setErrorMsg('Auth token missing. Please sign out & sign in.');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || (window.location.hostname === 'localhost' ? `${protocol}//localhost:5002/ws` : `${protocol}//${host}/ws`);

    console.log(`Connecting to WebSocket: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setErrorMsg(null);
      ws.send(JSON.stringify({
        type: 'start',
        token: activeToken,
        sessionId
      }));

      // Automatically start recording once connected
      startRecording();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case 'status':
            if (message.status === 'ready') {
              setStatus(isRecordingRef.current ? 'listening' : 'idle');
            } else if (message.status === 'processing') {
              setStatus('processing');
            } else if (message.status === 'playing') {
              setStatus('speaking');
            }
            break;

          case 'transcript':
            if (message.sender === 'user') {
              onUserText(message.text);
            } else {
              onAssistantText(message.text, message.isFinal);
            }
            break;

          case 'audio':
            audioQueueRef.current?.enqueueBase64(message.data);
            break;

          case 'session_created':
            onSessionCreated(message.sessionId);
            break;

          case 'error':
            setErrorMsg(message.message);
            console.error('Gateway error:', message.message);
            break;
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = (e) => {
      console.error('WebSocket error:', e);
      setConnected(false);
      setErrorMsg('Connection error. Retrying...');
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('WebSocket closed.');
    };
  };

  const disconnectWebSocket = () => {
    stopRecording();
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnected(false);
  };

  const startRecording = async () => {
    if (isMuted) return;

    // Barge-in: Interrupt playing audio
    audioQueueRef.current?.interrupt();
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      isRecordingRef.current = true;
      setStatus('listening');

      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      let options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'audio/ogg;codecs=opus' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: '' };
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN && !isMuted) {
          socketRef.current.send(event.data);
        }
      };

      mediaRecorder.start(200);

      if (mode === 'handsfree') {
        silenceStartRef.current = null;
        checkHandsfreeSilence();
      }
    } catch (err: any) {
      console.error('Microphone error:', err);
      const name = err?.name || '';
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setErrorMsg('No microphone found. Please connect a microphone and try again.');
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setErrorMsg('Microphone access denied. Please allow mic access in your browser settings.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setErrorMsg('Microphone is in use by another app. Please close other apps and try again.');
      } else {
        setErrorMsg(`Microphone error: ${err?.message || 'Unknown error'}. Try clicking the mic button to retry.`);
      }
      setStatus('idle');
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'stop' }));
    }

    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    
    analyserRef.current = null;
    setStatus('processing');
  };

  const checkHandsfreeSilence = () => {
    if (!isRecordingRef.current || !analyserRef.current || isMuted) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    lastVolumeRef.current = rms;

    const silenceThreshold = 0.012;
    if (rms < silenceThreshold) {
      if (silenceStartRef.current === null) {
        silenceStartRef.current = Date.now();
      } else {
        const elapsed = Date.now() - silenceStartRef.current;
        if (elapsed > 1800) {
          console.log('Client-side VAD: Silence detected, stopping speech input.');
          stopRecording();
          return;
        }
      }
    } else {
      silenceStartRef.current = null;
    }

    setTimeout(checkHandsfreeSilence, 100);
  };

  const handleMicButton = () => {
    if (!connected) return;

    if (isMuted) {
      // Unmute and start recording
      setIsMuted(false);
      setErrorMsg(null);
      setTimeout(() => startRecording(), 50);
    } else if (isRecordingRef.current) {
      // Currently listening — mute
      setIsMuted(true);
      stopRecording();
      setStatus('idle');
    } else {
      // Idle / failed mic — retry starting the mic
      setErrorMsg(null);
      startRecording();
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !connected) return;

    // Send text query to WebSocket backend
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      audioQueueRef.current?.interrupt();
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
      
      onUserText(textInput);
      socketRef.current.send(JSON.stringify({
        type: 'text_input',
        text: textInput
      }));
      
      setTextInput('');
      setStatus('processing');
    }
  };

  // Human readable RAG status text
  const getStatusLabel = () => {
    switch (status) {
      case 'listening':
        return isMuted ? 'Muted' : 'Listening...';
      case 'processing':
        return 'Thinking...';
      case 'speaking':
        return 'Speaking...';
      case 'idle':
      default:
        return connected ? 'Ready to talk' : 'Connecting...';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 flex flex-col justify-between p-6 md:p-12 transition-all duration-300">
      
      {/* Top Header */}
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs font-medium text-zinc-400 dark:text-zinc-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting to Voice Gateway...
            </span>
          )}
        </div>
        
        <div className="text-sm font-semibold tracking-wide text-zinc-500 uppercase text-[10px]">
          Voice Session
        </div>
      </div>

      {/* Error Message banner */}
      {errorMsg && (
        <div className="w-full max-w-md mx-auto bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-xs flex items-center gap-2 shadow-sm animate-bounce">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Center Section: Pulsing Gradient Orb */}
      <div className="flex-1 flex flex-col items-center justify-center relative my-8">
        
        {/* Glowing backdrop layer */}
        <div 
          ref={orbGlowRef}
          className="absolute w-64 h-64 rounded-full bg-gradient-to-tr from-blue-500 via-indigo-500 to-purple-500 filter blur-[40px] opacity-40 transition-all duration-100 ease-out" 
        />
        
        {/* Foreground Orb */}
        <div 
          ref={orbRef}
          className="relative w-48 h-48 rounded-full bg-gradient-to-tr from-blue-500 via-violet-400 to-purple-600 shadow-[0_0_60px_rgba(99,102,241,0.5)] transition-transform duration-100 ease-out flex items-center justify-center border border-white/10"
        />

        {/* Dynamic status label below the orb */}
        <div className="mt-12 text-center">
          <h2 className="text-xl font-medium text-zinc-800 dark:text-zinc-200 transition-all">
            {getStatusLabel()}
          </h2>
          {status === 'speaking' && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2 flex items-center justify-center gap-1.5 animate-pulse">
              <Volume2 className="w-3.5 h-3.5" /> Tap red mic to interrupt
            </p>
          )}
        </div>
      </div>

      {/* Bottom control pill / bar */}
      <div className="w-full max-w-xl mx-auto flex flex-col items-center gap-4">
        
        <form onSubmit={handleTextSubmit} className="w-full flex items-center gap-3 bg-zinc-100 dark:bg-zinc-900 rounded-full py-2 px-3 pl-4 border border-zinc-200/60 dark:border-zinc-850 shadow-sm focus-within:ring-2 focus-within:ring-zinc-200 dark:focus-within:ring-zinc-800 transition-all">
          <button 
            type="button"
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-2 rounded-full hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
          </button>
          
          <input 
            type="text" 
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type"
            className="flex-1 bg-transparent border-0 outline-none text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 dark:placeholder-zinc-600 text-[14px]"
            disabled={!connected}
          />
          
          <div className="flex items-center gap-1 shrink-0">
            {/* Mic button: red=active, grey=muted, outline=idle/retry */}
            <button
              type="button"
              onClick={handleMicButton}
              disabled={!connected}
              title={isMuted ? 'Unmute' : isRecordingRef.current ? 'Mute' : 'Tap to speak'}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                isMuted
                  ? 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                  : status === 'listening'
                  ? 'bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/30 ring-2 ring-red-300/40 animate-pulse'
                  : 'bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/20'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            
            {/* Black hang up / close button */}
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-zinc-950 hover:bg-zinc-900 dark:bg-zinc-805 dark:hover:bg-zinc-750 text-white flex items-center justify-center transition-all shadow-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
