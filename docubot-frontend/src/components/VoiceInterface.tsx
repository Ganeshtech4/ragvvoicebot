'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Wifi, WifiOff, RefreshCw, Square } from 'lucide-react';
import { AudioQueue } from '../utils/audioQueue';

interface VoiceInterfaceProps {
  tenantId: string;
  userId: string;
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onAssistantText: (text: string, isFinal: boolean) => void;
  onUserText: (text: string) => void;
}

type Mode = 'ptt' | 'handsfree';
type Status = 'idle' | 'listening' | 'processing' | 'speaking';

export default function VoiceInterface({
  tenantId,
  userId,
  sessionId,
  onSessionCreated,
  onAssistantText,
  onUserText,
}: VoiceInterfaceProps) {
  const [mode, setMode] = useState<Mode>('ptt');
  const [status, setStatus] = useState<Status>('idle');
  const [connected, setConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);

  // Web Audio refs for VAD (Voice Activity Detection) and visualizer
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Hands-free state management refs
  const isRecordingRef = useRef(false);
  const isSpeakingRef = useRef(false);
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
  }, [tenantId, userId]);

  const connectWebSocket = () => {
    disconnectWebSocket();
    setErrorMsg(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || (window.location.hostname === 'localhost' ? `${protocol}//localhost:5002/ws` : `${protocol}//${host}/ws`);

    console.log(`Connecting to WebSocket: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Initialize gateway session
      ws.send(JSON.stringify({
        type: 'start',
        tenantId,
        userId,
        sessionId
      }));
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
            // Receive synthesized speech chunk from gateway
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
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnected(false);
  };

  // --- AUDIO CAPTURE AND STREAMING LOGIC ---

  const startRecording = async () => {
    // 1. Barge-in: Interrupt any playing assistant audio immediately
    audioQueueRef.current?.interrupt();
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }

    try {
      // 2. Request mic permissions
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      isRecordingRef.current = true;
      setStatus('listening');

      // 3. Setup Web Audio API analyser for visualizer & volume checks
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtxRef.current.createMediaStreamSource(stream);
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start Canvas Visualization
      drawVisualizer();

      // 4. Initialize MediaRecorder
      // Try WebM format first as it supports streaming well, fallback to default
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
        if (event.data && event.data.size > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          // Stream raw audio chunks to the voice gateway
          socketRef.current.send(event.data);
        }
      };

      // Slice audio into 200ms segments
      mediaRecorder.start(200);

      // Start client VAD loops if in handsfree mode
      if (mode === 'handsfree') {
        silenceStartRef.current = null;
        checkHandsfreeSilence();
      }
    } catch (err) {
      console.error('Microphone access denied:', err);
      setErrorMsg('Microphone access denied. Please check permissions.');
      setStatus('idle');
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    
    // Stop recording and close streams
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    
    // Send end of audio trigger to gateway
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'stop' }));
    }

    // Cleanup AudioContext/VAD loops
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    
    analyserRef.current = null;
    setStatus('processing');
  };

  // --- CLIENT-SIDE VAD (SILENCE DETECTION) ---

  const checkHandsfreeSilence = () => {
    if (!isRecordingRef.current || !analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(dataArray);

    // Calculate RMS (root-mean-square) volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    lastVolumeRef.current = rms;

    // Silence detection threshold: volume less than 0.012
    const silenceThreshold = 0.012;
    if (rms < silenceThreshold) {
      if (silenceStartRef.current === null) {
        silenceStartRef.current = Date.now();
      } else {
        const elapsed = Date.now() - silenceStartRef.current;
        // If user is silent for 1.8 seconds, stop recording and request response
        if (elapsed > 1800) {
          console.log('Client-side VAD: Silence detected, stopping speech input.');
          stopRecording();
          return;
        }
      }
    } else {
      // User is speaking, reset silence timer
      silenceStartRef.current = null;
    }

    // Check again in 100ms
    setTimeout(checkHandsfreeSilence, 100);
  };

  // --- AUDIO WAVE VISUALIZER ---

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!analyserRef.current) return;
      animationFrameRef.current = requestAnimationFrame(draw);

      analyserRef.current.getByteTimeDomainData(dataArray);

      // Clean background with a glassy dark overlay
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      // Draw horizontal reference line
      ctx.lineWidth = 2;
      
      // Determine wave color based on state
      let strokeColor = '#38bdf8'; // Sky blue for listening
      if (status === 'speaking') strokeColor = '#34d399'; // Green for speaking
      if (status === 'processing') strokeColor = '#fb7185'; // Rose for processing
      
      ctx.strokeStyle = strokeColor;
      ctx.beginPath();

      const sliceWidth = (width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        // Normalize 8-bit signal to [-1.0, 1.0]
        const v = dataArray[i] / 128.0;
        const y = (v * height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(width, height / 2);
      ctx.stroke();

      // Add a cool glowing center point
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.max(5, lastVolumeRef.current * 100), 0, 2 * Math.PI);
      ctx.fillStyle = strokeColor + '44';
      ctx.fill();
    };

    draw();
  };

  // Static/Fallback wave visualization for idle states
  useEffect(() => {
    if (status === 'idle' || status === 'speaking' || status === 'processing') {
      // Draw a slow pulsing sine wave when idle to make it feel alive
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      let phase = 0;

      const drawIdle = () => {
        if (analyserRef.current) return; // let active mic visualization handle it
        
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        // Draw multiple layered sine waves for premium aesthetic
        const drawWave = (amplitude: number, freq: number, opacity: string, speed: number) => {
          ctx.strokeStyle = `rgba(56, 189, 248, ${opacity})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let x = 0; x < width; x++) {
            const y = height / 2 + Math.sin(x * freq + phase * speed) * amplitude;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };

        // Draw three offset waves
        drawWave(10, 0.015, '0.6', 1);
        drawWave(6, 0.025, '0.3', -1.5);
        drawWave(14, 0.008, '0.15', 0.5);

        phase += 0.05;
        animationFrameRef.current = requestAnimationFrame(drawIdle);
      };

      drawIdle();

      return () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      };
    }
  }, [status]);

  // --- BUTTON MOUSE / TOUCH EVENTS ---

  const handleMouseDown = () => {
    if (mode !== 'ptt' || !connected) return;
    startRecording();
  };

  const handleMouseUp = () => {
    if (mode !== 'ptt' || !connected) return;
    stopRecording();
  };

  const toggleHandsfree = () => {
    if (!connected) return;
    
    if (status === 'listening') {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleInterrupt = () => {
    audioQueueRef.current?.interrupt();
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setStatus('idle');
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 p-6 flex flex-col items-center justify-between w-full max-w-md mx-auto shadow-2xl">
      {/* Top Details & Status */}
      <div className="w-full flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <Wifi size={14} /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-semibold text-rose-400">
              <WifiOff size={14} /> Disconnected
            </span>
          )}
        </div>
        
        {/* Toggle Mode Button */}
        <div className="flex bg-slate-800/80 p-1 rounded-lg border border-slate-700">
          <button
            onClick={() => {
              if (isRecordingRef.current) stopRecording();
              setMode('ptt');
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'ptt' ? 'bg-sky-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Push to Talk
          </button>
          <button
            onClick={() => {
              if (isRecordingRef.current) stopRecording();
              setMode('handsfree');
            }}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              mode === 'handsfree' ? 'bg-sky-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Hands-Free
          </button>
        </div>
      </div>

      {/* Canvas Visualizer */}
      <div className="w-full h-32 bg-slate-950 rounded-xl overflow-hidden border border-slate-800/80 mb-6 relative">
        <canvas ref={canvasRef} className="w-full h-full" width={400} height={128} />
        
        {/* Floating status label */}
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-slate-900/60 border border-slate-800 text-sky-400 backdrop-blur-sm">
          {status}
        </div>

        {/* Action instruction display */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {status === 'idle' && (
            <span className="text-slate-500 text-xs font-medium">
              {mode === 'ptt' ? 'Hold button below to talk' : 'Click microphone to start hands-free'}
            </span>
          )}
          {status === 'listening' && (
            <span className="text-sky-400/80 text-xs font-medium animate-pulse">
              Listening...
            </span>
          )}
          {status === 'processing' && (
            <span className="text-rose-400/80 text-xs font-medium animate-pulse">
              Transcribing & Searching RAG...
            </span>
          )}
          {status === 'speaking' && (
            <span className="text-emerald-400/80 text-xs font-medium flex items-center gap-1">
              <Volume2 size={12} className="animate-bounce" /> Assistant Speaking
            </span>
          )}
        </div>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="w-full bg-rose-950/40 border border-rose-900 text-rose-300 px-3 py-2 rounded-lg text-xs mb-4 text-center">
          {errorMsg}
        </div>
      )}

      {/* Main Action Controllers */}
      <div className="flex flex-col items-center gap-4 w-full">
        {mode === 'ptt' ? (
          <button
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            disabled={!connected}
            className={`w-24 h-24 rounded-full flex items-center justify-center border transition-all cursor-pointer select-none active:scale-95 ${
              status === 'listening'
                ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-600/30'
                : 'bg-sky-600 border-sky-500 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 disabled:bg-slate-800 disabled:border-slate-800 disabled:text-slate-600'
            }`}
          >
            {status === 'listening' ? <Mic size={36} className="animate-ping" /> : <Mic size={36} />}
          </button>
        ) : (
          <button
            onClick={toggleHandsfree}
            disabled={!connected}
            className={`w-24 h-24 rounded-full flex items-center justify-center border transition-all active:scale-95 ${
              status === 'listening'
                ? 'bg-rose-600 border-rose-500 text-white shadow-lg shadow-rose-600/30'
                : 'bg-sky-600 border-sky-500 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 disabled:bg-slate-800 disabled:border-slate-800 disabled:text-slate-600'
            }`}
          >
            {status === 'listening' ? <Square size={32} /> : <Mic size={36} />}
          </button>
        )}

        {/* Push-to-Talk Release Label */}
        {mode === 'ptt' && status === 'listening' && (
          <span className="text-[10px] text-rose-400 font-semibold animate-pulse">
            RELEASE BUTTON TO SEND
          </span>
        )}

        {/* Barge-In Interruption Button */}
        {(status === 'speaking' || status === 'processing') && (
          <button
            onClick={handleInterrupt}
            className="flex items-center gap-1 px-4 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors shadow-md"
          >
            <MicOff size={14} /> Interrupt Assistant
          </button>
        )}
      </div>

      {/* Reconnect helper if disconnected */}
      {!connected && (
        <button
          onClick={connectWebSocket}
          className="mt-4 flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold transition-colors"
        >
          <RefreshCw size={12} /> Reconnect Voice Gateway
        </button>
      )}
    </div>
  );
}
