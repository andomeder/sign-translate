import {Component, inject, OnInit, OnDestroy, PLATFORM_ID, CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {CommonModule, isPlatformBrowser} from '@angular/common';
import {Store} from '@ngxs/store';
import {SignedLanguageOutputComponent} from '../spoken-to-signed/signed-language-output/signed-language-output.component';
import {SetSpokenLanguageText} from '../../../modules/translate/translate.actions';

interface Chunk {
  text: string;
  timestamp: number; // in seconds
}

@Component({
  selector: 'app-renderer',
  standalone: true,
  imports: [SignedLanguageOutputComponent, CommonModule],
  template: `
    <div class="renderer-container">
      <app-signed-language-output></app-signed-language-output>
      <div class="debug-info" *ngIf="showDebug">
        <div>Playback: {{ isPlaying ? '▶️' : '⏸️' }}</div>
        <div>Chunk: {{ currentChunkIndex + 1 }}/{{ chunks.length }}</div>
        <div>Animating: {{ isAnimating ? '🎨' : '✅' }}</div>
        <div *ngIf="chunks.length > 0">Text: {{ getCurrentChunkText() }}</div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .renderer-container {
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #202124;
        position: relative;
      }

      .debug-info {
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: #4caf50;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 12px;
        max-width: 300px;
      }

      .debug-info div {
        margin: 2px 0;
      }

      ::ng-deep pose-viewer {
        visibility: visible !important;
        display: block !important;
        width: 100% !important;
        max-width: 800px;
        height: auto !important;
        min-height: 400px;
      }

      ::ng-deep app-signed-language-output {
        width: 100%;
        max-width: 800px;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
    `,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class RendererComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private platformId = inject(PLATFORM_ID);
  private ws: WebSocket | null = null;

  // Playback state
  chunks: Chunk[] = [];
  currentChunkIndex = -1;
  isPlaying = false;
  startTime = 0;
  currentTime = 0;
  showDebug = true;

  // For handling pause/resume
  pausedAt = 0;

  // Animation timing
  isAnimating = false;
  animationStartTime = 0;

  private animationFrameId: number | null = null;
  private readonly MIN_CHUNK_DURATION = 4; // Minimum 4 seconds per chunk
  private readonly ESTIMATED_ANIMATION_TIME = 7; // Estimate 7 seconds for animations

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      console.log('🚀 Renderer ready - connecting to daemon');
      this.connectToDaemon();
      this.startPlaybackLoop();
    }
  }

  ngOnDestroy(): void {
    if (this.ws) {
      this.ws.close();
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  private connectToDaemon(): void {
    try {
      this.ws = new WebSocket('ws://localhost:8765');

      this.ws.onopen = () => {
        console.log('✓ Connected to daemon');
      };

      this.ws.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          console.log('📥 Received from daemon:', data.type);

          switch (data.type) {
            case 'PLAYBACK_QUEUE':
              this.loadQueue(data.queue, data.start_time);
              break;
            case 'PLAYBACK_APPEND':
              this.appendChunks(data.chunks);
              break;
            case 'PLAYBACK_START':
              this.startPlayback(data.start_time);
              break;
            case 'PLAYBACK_PAUSE':
              this.pausePlayback();
              break;
            case 'PLAYBACK_RESUME':
              this.resumePlayback();
              break;
            case 'PLAYBACK_SEEK':
              this.seekTo(data.time);
              break;
            case 'PLAYBACK_STOP':
              this.stopPlayback();
              break;
            case 'INFO':
            case 'STATUS':
              console.log('ℹ️', data.message);
              break;
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      this.ws.onerror = error => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('🔌 Disconnected from daemon');
        setTimeout(() => this.connectToDaemon(), 5000);
      };
    } catch (error) {
      console.error('Failed to connect to daemon:', error);
    }
  }

  private loadQueue(chunks: Chunk[], serverStartTime?: number): void {
    console.log(`📋 Loading queue with ${chunks.length} chunks`);
    console.log(
      'Chunks:',
      chunks.map(c => `t=${c.timestamp}s: "${c.text.substring(0, 30)}..."`)
    );

    this.chunks = chunks.sort((a, b) => a.timestamp - b.timestamp);
    this.currentChunkIndex = -1;

    // Start playback synchronized with server time
    const now = Date.now() / 1000;
    this.startTime = serverStartTime || now;
    this.isPlaying = true;

    console.log(`▶️ Playback started at ${this.startTime}, current time: ${now}, chunks: ${this.chunks.length}`);
  }

  private appendChunks(newChunks: Chunk[]): void {
    console.log(`➕ Appending ${newChunks.length} chunks to existing queue`);
    console.log(
      'New chunks:',
      newChunks.map(c => `t=${c.timestamp}s: "${c.text}"`)
    );

    // If we don't have a playback session yet (missed the initial QUEUE),
    // treat this as the first queue
    if (!this.isPlaying && this.chunks.length === 0) {
      console.log('⚠️ No active playback - treating append as new queue');
      this.chunks = [...newChunks];
      this.chunks.sort((a, b) => a.timestamp - b.timestamp);
      this.currentChunkIndex = -1;
      this.startTime = Date.now() / 1000;
      this.isPlaying = true;
      console.log(`▶️ Started playback with ${this.chunks.length} chunks`);
      return;
    }

    // Add new chunks to existing queue
    this.chunks.push(...newChunks);
    this.chunks.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`📋 Total chunks now: ${this.chunks.length}`);
    console.log(`Current playback time: ${this.currentTime.toFixed(1)}s, on chunk ${this.currentChunkIndex + 1}`);
  }

  private startPlayback(startTime?: number): void {
    this.isPlaying = true;
    this.startTime = startTime || Date.now() / 1000;
    this.currentChunkIndex = -1;
    this.pausedAt = 0;
    console.log('▶️ Playback started');
  }

  private pausePlayback(): void {
    if (this.isPlaying) {
      this.pausedAt = this.currentTime;
      this.isPlaying = false;
      console.log('⏸️ Playback paused at', this.currentTime.toFixed(1), 's');
    }
  }

  private resumePlayback(): void {
    if (!this.isPlaying) {
      // Adjust start time to account for pause
      this.startTime = Date.now() / 1000 - this.pausedAt;
      this.isPlaying = true;
      console.log('▶️ Playback resumed from', this.pausedAt.toFixed(1), 's');
    }
  }

  private seekTo(time: number): void {
    this.currentTime = time;
    this.startTime = Date.now() / 1000 - time;
    this.pausedAt = time;

    // Find the chunk that should be playing at this time
    this.currentChunkIndex = this.findChunkIndexAtTime(time);

    // Display the chunk at this time
    if (this.currentChunkIndex >= 0 && this.currentChunkIndex < this.chunks.length) {
      const chunk = this.chunks[this.currentChunkIndex];
      this.store.dispatch(new SetSpokenLanguageText(chunk.text));
      console.log(`⏩ Seeked to ${time.toFixed(1)}s, displaying chunk ${this.currentChunkIndex + 1}: "${chunk.text}"`);
    }
  }

  private stopPlayback(): void {
    this.isPlaying = false;
    this.chunks = [];
    this.currentChunkIndex = -1;
    this.currentTime = 0;
    this.pausedAt = 0;
    console.log('⏹️ Playback stopped');
  }

  private findChunkIndexAtTime(time: number): number {
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const nextChunk = this.chunks[i + 1];

      const chunkEnd = nextChunk ? nextChunk.timestamp : chunk.timestamp + this.ESTIMATED_ANIMATION_TIME;

      if (time >= chunk.timestamp && time < chunkEnd) {
        return i;
      }
    }

    // If we're past all chunks, return the last one
    return this.chunks.length - 1;
  }

  private startPlaybackLoop(): void {
    const loop = () => {
      if (this.isPlaying && this.chunks.length > 0) {
        const now = Date.now() / 1000;
        this.currentTime = now - this.startTime;

        // If we haven't started yet, play the first chunk
        if (this.currentChunkIndex === -1 && this.chunks.length > 0) {
          this.playChunk(0);
        }
        // Check if we should advance to the next chunk
        else if (this.currentChunkIndex >= 0 && this.currentChunkIndex < this.chunks.length - 1) {
          const timeSinceLastAnimation = now - this.animationStartTime;

          // Advance if enough time has passed
          if (timeSinceLastAnimation >= this.MIN_CHUNK_DURATION) {
            const nextIndex = this.currentChunkIndex + 1;
            this.playChunk(nextIndex);
          }
        }
        // Check if we're completely done
        else if (this.currentChunkIndex >= this.chunks.length - 1) {
          const timeSinceLastAnimation = now - this.animationStartTime;
          if (timeSinceLastAnimation > this.ESTIMATED_ANIMATION_TIME) {
            console.log('✓ Playback complete - all animations finished');
            this.stopPlayback();
          }
        }
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };

    loop();
  }

  private playChunk(index: number): void {
    if (index < 0 || index >= this.chunks.length || index === this.currentChunkIndex) {
      return;
    }

    this.currentChunkIndex = index;
    const chunk = this.chunks[index];
    const now = Date.now() / 1000;

    this.isAnimating = true;
    this.animationStartTime = now;

    console.log(`🎬 Playing chunk ${index + 1}/${this.chunks.length}: "${chunk.text}"`);
    this.store.dispatch(new SetSpokenLanguageText(chunk.text));
  }

  getCurrentChunkText(): string {
    if (this.currentChunkIndex >= 0 && this.currentChunkIndex < this.chunks.length) {
      return this.chunks[this.currentChunkIndex].text.substring(0, 50) + '...';
    }
    return '';
  }

  getNextChunkTime(): string {
    if (this.currentChunkIndex >= 0 && this.currentChunkIndex < this.chunks.length - 1) {
      return this.chunks[this.currentChunkIndex + 1].timestamp.toFixed(1);
    }
    return 'end';
  }

  // Optional: keyboard controls
  private handleKeyPress(event: KeyboardEvent): void {
    if (!this.ws) return;

    switch (event.key) {
      case ' ':
        // Space bar to pause/resume
        const command = this.isPlaying ? 'PLAYBACK_PAUSE' : 'PLAYBACK_RESUME';
        this.ws.send(JSON.stringify({type: command}));
        break;
      case 'ArrowLeft':
        // Seek back 5 seconds
        const newTime = Math.max(0, this.currentTime - 5);
        this.ws.send(JSON.stringify({type: 'PLAYBACK_SEEK', time: newTime}));
        break;
      case 'ArrowRight':
        // Seek forward 5 seconds
        this.ws.send(JSON.stringify({type: 'PLAYBACK_SEEK', time: this.currentTime + 5}));
        break;
    }
  }
}
