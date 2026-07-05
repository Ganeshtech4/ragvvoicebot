export class AudioQueue {
  private ctx: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private sources: AudioBufferSourceNode[] = [];
  private isPlaying: boolean = false;
  private audioBufferQueue: ArrayBuffer[] = [];

  constructor() {
    // AudioContext is initialized lazily upon first interaction to comply with browser policies
  }

  private initContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Enqueues a base64-encoded audio chunk for playback
   */
  public async enqueueBase64(base64Data: string): Promise<void> {
    this.initContext();
    if (!this.ctx) return;

    try {
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const arrayBuffer = bytes.buffer;
      this.audioBufferQueue.push(arrayBuffer);
      this.processQueue();
    } catch (e) {
      console.error('Failed to decode and enqueue base64 audio:', e);
    }
  }

  private async processQueue() {
    if (this.isPlaying || this.audioBufferQueue.length === 0 || !this.ctx) return;

    this.isPlaying = true;
    const arrayBuffer = this.audioBufferQueue.shift();
    if (!arrayBuffer) {
      this.isPlaying = false;
      return;
    }

    try {
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
      this.playBuffer(audioBuffer);
    } catch (e) {
      console.error('Error decoding audio data:', e);
      this.isPlaying = false;
      this.processQueue();
    }
  }

  private playBuffer(buffer: AudioBuffer) {
    if (!this.ctx) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    // Schedule play time to avoid clicks/gaps
    const now = this.ctx.currentTime;
    let startTime = now;

    if (this.nextPlayTime > now) {
      startTime = this.nextPlayTime;
    }

    source.start(startTime);
    this.nextPlayTime = startTime + buffer.duration;
    this.sources.push(source);

    source.onended = () => {
      // Remove source from tracking list
      this.sources = this.sources.filter(s => s !== source);
      this.isPlaying = false;
      
      // If queue is empty and all playing finished, reset schedule clock
      if (this.sources.length === 0 && this.audioBufferQueue.length === 0) {
        this.nextPlayTime = 0;
      }
      
      this.processQueue();
    };
  }

  /**
   * Instantly stops all current and queued audio playback
   */
  public interrupt(): void {
    console.log('Audio playback interrupted (barge-in)');
    
    // Stop all active sources
    this.sources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source may have already stopped or not started
      }
    });
    
    this.sources = [];
    this.audioBufferQueue = [];
    this.nextPlayTime = 0;
    this.isPlaying = false;
  }

  /**
   * Resumes the AudioContext if it was suspended
   */
  public resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}
