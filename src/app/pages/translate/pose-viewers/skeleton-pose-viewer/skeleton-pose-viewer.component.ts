import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  PLATFORM_ID,
  inject,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {fromEvent} from 'rxjs';
import {takeUntil, tap} from 'rxjs/operators';
import {BasePoseViewerComponent} from '../pose-viewer.component';
import {PlayableVideoEncoder} from '../playable-video-encoder';

@Component({
  selector: 'app-skeleton-pose-viewer',
  templateUrl: './skeleton-pose-viewer.component.html',
  styleUrls: ['./skeleton-pose-viewer.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SkeletonPoseViewerComponent extends BasePoseViewerComponent implements OnInit, AfterViewInit, OnChanges {
  @Input() src: string;

  private platformId = inject(PLATFORM_ID);
  private elementReady = false;
  private instanceReady = false;

  override async ngOnInit(): Promise<void> {
    await super.ngOnInit();

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Pre-load the custom element definition
    await this.ensureCustomElementDefined();
  }

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Wait for custom element to be fully defined
    await this.ensureCustomElementDefined();

    // Wait for this specific instance to be ready
    await this.waitForElementInstance();

    this.instanceReady = true;

    // NOW set the src attribute
    if (this.src) {
      this.applySrc(this.src);
    }

    const pose = this.poseEl().nativeElement;

    // Set up event listeners with error handling
    this.setupEventListeners(pose);

    this.pauseInvisible();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Only apply src changes if the instance is ready
    if (changes['src'] && this.instanceReady && this.src) {
      this.applySrc(this.src);
    }
  }

  /**
   * Safely apply the src attribute to the pose-viewer element
   */
  private applySrc(src: string): void {
    const pose = this.poseEl()?.nativeElement;
    if (!pose) {
      console.warn('Cannot apply src - pose element not found');
      return;
    }

    console.log('📍 Setting pose-viewer src:', src);

    try {
      // Set both attribute and property
      pose.setAttribute('src', src);
      pose.src = src;
    } catch (error) {
      console.error('Error setting src:', error);
    }
  }

  /**
   * Ensure the pose-viewer custom element is defined before we try to use it
   */
  private async ensureCustomElementDefined(): Promise<void> {
    if (this.elementReady) return;

    try {
      console.log('⏳ Waiting for pose-viewer custom element definition...');

      // Wait for the custom element to be defined
      if (typeof customElements !== 'undefined' && customElements.whenDefined) {
        await customElements.whenDefined('pose-viewer');
        console.log('✓ pose-viewer custom element is defined');
      } else {
        // Fallback: poll for the custom element
        let attempts = 0;
        while (attempts < 100) {
          if (customElements && customElements.get('pose-viewer')) {
            console.log('✓ pose-viewer found via polling');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        if (attempts >= 100) {
          console.error('✗ pose-viewer custom element never registered');
        }
      }

      this.elementReady = true;
    } catch (error) {
      console.error('Error waiting for custom element:', error);
    }
  }

  /**
   * Wait for this specific pose-viewer instance to be initialized
   */
  private async waitForElementInstance(): Promise<void> {
    const pose = this.poseEl()?.nativeElement;
    if (!pose) {
      console.warn('pose element not found');
      return;
    }

    console.log('⏳ Waiting for pose-viewer instance to initialize...');

    // Method 1: Use Stencil's componentOnReady
    if (typeof pose.componentOnReady === 'function') {
      try {
        await pose.componentOnReady();
        console.log('✓ componentOnReady completed');
        // Add extra delay to ensure everything is fully initialized
        await new Promise(resolve => setTimeout(resolve, 100));
        return;
      } catch (e) {
        console.warn('componentOnReady failed:', e);
      }
    }

    // Method 2: Wait for shadow DOM
    let attempts = 0;
    while (attempts < 50) {
      if (pose.shadowRoot) {
        console.log('✓ Shadow DOM attached');
        // Extra delay after shadow DOM is attached
        await new Promise(resolve => setTimeout(resolve, 200));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    console.warn('⚠ Instance initialization timeout - continuing anyway');
  }

  private setupEventListeners(pose: any): void {
    fromEvent(pose, 'firstRender$')
      .pipe(
        tap(async () => {
          try {
            const poseCanvas = pose.shadowRoot?.querySelector('canvas');
            if (!poseCanvas) {
              console.warn('Canvas not found in shadow DOM during firstRender$');
              return;
            }

            pose.currentTime = 0;

            if (!PlayableVideoEncoder.isSupported()) {
              const ctx = poseCanvas.getContext('2d');
              if (ctx) {
                await this.startRecording(poseCanvas as any);
              }
            }
          } catch (error) {
            console.error('Error in firstRender$:', error);
          }
        }),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe();

    if (PlayableVideoEncoder.isSupported()) {
      let lastRendered = NaN;
      fromEvent(pose, 'render$')
        .pipe(
          tap(async () => {
            try {
              if (pose.currentTime === lastRendered) {
                return;
              }

              const poseCanvas = pose.shadowRoot?.querySelector('canvas');
              if (!poseCanvas) {
                return;
              }

              const ctx = poseCanvas.getContext('2d');
              if (!ctx) {
                return;
              }

              const imageBitmap = await createImageBitmap(poseCanvas);
              await this.addCacheFrame(imageBitmap);
              lastRendered = pose.currentTime;
            } catch (error) {
              if (error instanceof DOMException && error.name === 'InvalidStateError') {
                return;
              }
              console.error('Error in render$:', error);
            }
          }),
          takeUntil(this.ngUnsubscribe)
        )
        .subscribe();
    }

    fromEvent(pose, 'ended$')
      .pipe(
        tap(async () => {
          try {
            await this.stopRecording();
          } catch (error) {
            console.error('Error in ended$:', error);
          }
        }),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe();
  }

  pauseInvisible() {
    const pose = this.poseEl().nativeElement;

    fromEvent(document, 'visibilitychange')
      .pipe(
        tap(async () => {
          try {
            if (document.visibilityState === 'visible') {
              await pose.play();
              if (this.mediaRecorder) {
                this.mediaRecorder.resume();
              }
            } else {
              await pose.pause();
              if (this.mediaRecorder) {
                this.mediaRecorder.pause();
              }
            }
          } catch (error) {
            console.error('Error in visibility change:', error);
          }
        }),
        takeUntil(this.ngUnsubscribe)
      )
      .subscribe();
  }
}
