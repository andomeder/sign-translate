import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  PLATFORM_ID,
  CUSTOM_ELEMENTS_SCHEMA,
  AfterViewInit,
  ElementRef,
  ViewChild,
  NgZone,
} from '@angular/core';
import {CommonModule, isPlatformBrowser} from '@angular/common';
import {Store} from '@ngxs/store';
import {SignedLanguageOutputComponent} from '../spoken-to-signed/signed-language-output/signed-language-output.component';
import {SetSpokenLanguageText} from '../../../modules/translate/translate.actions';
import {fromEvent, Subject, Subscription, interval} from 'rxjs';
import {takeUntil, filter} from 'rxjs/operators';

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
export class RendererComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('containerRef') containerRef!: ElementRef<HTMLElement>;

  private store = inject(Store);
  private platformId = inject(PLATFORM_ID);
  private ngZone = inject(NgZone);
  private ws: WebSocket | null = null;
  private destroy$ = new Subject<void>();

  // Playback state
  chunks: Chunk[] = [];
  currentChunkIndex = -1;
  isPlaying = false;
  startTime = 0;
  currentTime = 0;
  showDebug = true;

  // For handling pause/resume
  pausedAt = 0;

  // Animation state - now event-driven instead of time-based
  isAnimating = false;
  private poseViewerSubscription: Subscription | null = null;
  private currentPoseViewer: HTMLElement | null = null;

  // Idle detection
  private lastChunkReceivedTime = 0;
  private readonly IDLE_TIMEOUT_SECONDS = 30; // Stop if no new chunks for 30s
  idleSeconds = 0;

  // Fallback timeout for animations that don't emit ended$
  private animationFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_ANIMATION_TIME = 15; // Max 15 seconds per animation as fallback
  private readonly MIN_ANIMATION_TIME = 2; // Minimum 2 seconds before allowing advance

  // Track animation start for minimum time enforcement
  private animationStartTime = 0;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      console.log('[Renderer] Ready - connecting to daemon');
      this.connectToDaemon();
      this.startIdleDetection();
    }
  }

  ngAfterViewInit(): void {
    // Set up a MutationObserver to detect when pose-viewer elements appear/change
    if (isPlatformBrowser(this.platformId) && this.containerRef) {
      this.setupPoseViewerObserver();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    if (this.ws) {
      this.ws.close();
    }
    if (this.poseViewerSubscription) {
      this.poseViewerSubscription.unsubscribe();
    }
    if (this.animationFallbackTimeout) {
      clearTimeout(this.animationFallbackTimeout);
    }
  }

  /**
   * Set up MutationObserver to detect pose-viewer elements in the DOM
   * and subscribe to their ended$ events
   */
  private setupPoseViewerObserver(): void {
    const container = this.containerRef.nativeElement;

    const observer = new MutationObserver(mutations => {
      // Look for pose-viewer elements
      const poseViewer = container.querySelector('pose-viewer');
      if (poseViewer && poseViewer !== this.currentPoseViewer) {
        console.log('[Renderer] New pose-viewer detected, setting up event listeners');
        this.subscribeToPoseViewer(poseViewer as HTMLElement);
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    // Also check immediately in case it's already there
    const existingPoseViewer = container.querySelector('pose-viewer');
    if (existingPoseViewer) {
      this.subscribeToPoseViewer(existingPoseViewer as HTMLElement);
    }

    // Clean up observer on destroy
    this.destroy$.subscribe(() => observer.disconnect());
  }

  /**
   * Subscribe to pose-viewer events (ended$, firstRender$, etc.)
   */
  private subscribeToPoseViewer(poseViewer: HTMLElement): void {
    // Unsubscribe from previous pose-viewer
    if (this.poseViewerSubscription) {
      this.poseViewerSubscription.unsubscribe();
    }

    this.currentPoseViewer = poseViewer;

    // Listen for ended$ event - this is the key event for animation completion
    this.poseViewerSubscription = fromEvent(poseViewer, 'ended$')
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.ngZone.run(() => {
          this.onAnimationEnded();
        });
      });

    // Also listen for firstRender$ to know when animation actually starts
    fromEvent(poseViewer, 'firstRender$')
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.ngZone.run(() => {
          console.log('[Renderer] Animation first render');
          this.animationStartTime = Date.now() / 1000;
        });
      });

    console.log('[Renderer] Subscribed to pose-viewer events');
  }

  /**
   * Called when the pose-viewer emits ended$ event
   */
  private onAnimationEnded(): void {
    console.log(`[Renderer] Animation ended for chunk ${this.currentChunkIndex + 1}`);

    // Clear the fallback timeout
    if (this.animationFallbackTimeout) {
      clearTimeout(this.animationFallbackTimeout);
      this.animationFallbackTimeout = null;
    }

    this.isAnimating = false;

    // Check if there are more chunks to play
    if (this.currentChunkIndex < this.chunks.length - 1) {
      // Advance to next chunk
      this.playChunk(this.currentChunkIndex + 1);
    } else {
      console.log('[Renderer] All chunks completed');
      // Don't stop immediately - wait for more chunks or idle timeout
    }
  }

  /**
   * Start idle detection - stops playback if no new chunks arrive
   */
  private startIdleDetection(): void {
    interval(1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.isPlaying && this.lastChunkReceivedTime > 0) {
          const now = Date.now() / 1000;
          this.idleSeconds = now - this.lastChunkReceivedTime;

          // If we've been idle too long and finished all chunks, stop
          if (
            this.idleSeconds > this.IDLE_TIMEOUT_SECONDS &&
            this.currentChunkIndex >= this.chunks.length - 1 &&
            !this.isAnimating
          ) {
            console.log(`[Renderer] Idle timeout (${this.IDLE_TIMEOUT_SECONDS}s) - stopping playback`);
            this.stopPlayback();
          }
        }
      });
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
    this.isAnimating = false;
    this.idleSeconds = 0;

    if (this.animationFallbackTimeout) {
      clearTimeout(this.animationFallbackTimeout);
      this.animationFallbackTimeout = null;
    }

    console.log('[Renderer] Playback stopped');
  }

  private findChunkIndexAtTime(time: number): number {
    // Find the chunk whose timestamp is closest to but not exceeding the target time
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this.chunks[i].timestamp <= time) {
        return i;
      }
    }
    return 0;
  }

  private playChunk(index: number): void {
    if (index < 0 || index >= this.chunks.length) {
      return;
    }

    // Don't interrupt current animation unless we're way behind
    if (this.isAnimating && index === this.currentChunkIndex) {
      return;
    }

    // Enforce minimum animation time
    const now = Date.now() / 1000;
    const timeSinceStart = now - this.animationStartTime;
    if (this.isAnimating && timeSinceStart < this.MIN_ANIMATION_TIME) {
      console.log(
        `[Renderer] Waiting for min animation time (${timeSinceStart.toFixed(1)}s < ${this.MIN_ANIMATION_TIME}s)`
      );
      return;
    }

    this.currentChunkIndex = index;
    const chunk = this.chunks[index];

    this.isAnimating = true;
    this.animationStartTime = now;

    console.log(`[Renderer] Playing chunk ${index + 1}/${this.chunks.length}: "${chunk.text}"`);
    this.store.dispatch(new SetSpokenLanguageText(chunk.text));

    // Set up fallback timeout in case ended$ doesn't fire
    if (this.animationFallbackTimeout) {
      clearTimeout(this.animationFallbackTimeout);
    }
    this.animationFallbackTimeout = setTimeout(() => {
      if (this.isAnimating && this.currentChunkIndex === index) {
        console.log(`[Renderer] Fallback timeout for chunk ${index + 1} - advancing`);
        this.onAnimationEnded();
      }
    }, this.MAX_ANIMATION_TIME * 1000);
  }

  getCurrentChunkText(): string {
    if (this.currentChunkIndex >= 0 && this.currentChunkIndex < this.chunks.length) {
      const text = this.chunks[this.currentChunkIndex].text;
      return text.length > 50 ? text.substring(0, 50) + '...' : text;
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
