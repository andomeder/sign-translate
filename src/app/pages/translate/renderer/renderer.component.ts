import {Component, inject, OnInit, OnDestroy, PLATFORM_ID, CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {Store} from '@ngxs/store';
import {SignedLanguageOutputComponent} from '../spoken-to-signed/signed-language-output/signed-language-output.component';
import {SetSpokenLanguageText} from '../../../modules/translate/translate.actions';

@Component({
  selector: 'app-renderer',
  standalone: true,
  imports: [SignedLanguageOutputComponent],
  template: `
    <div class="renderer-container">
      <app-signed-language-output></app-signed-language-output>
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

      /* Ensure pose-viewer is visible and sized */
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

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      console.log('🚀 Renderer ready - connecting to daemon');
      this.connectToDaemon();
    }
  }

  ngOnDestroy(): void {
    if (this.ws) {
      this.ws.close();
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
          console.log('📥 Received from daemon:', data);

          if (data.type === 'PLAYBACK_QUEUE' && Array.isArray(data.queue)) {
            // Process queue sequentially
            this.processQueue(data.queue);
          } else if (data.type === 'INFO' || data.type === 'STATUS') {
            console.log('ℹ️ Status:', data.message);
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
        // Optionally reconnect after delay
        setTimeout(() => this.connectToDaemon(), 5000);
      };
    } catch (error) {
      console.error('Failed to connect to daemon:', error);
    }
  }

  private async processQueue(queue: Array<{text: string; timestamp: number}>): Promise<void> {
    for (const chunk of queue) {
      if (chunk.text) {
        console.log('📝 Translating:', chunk.text);
        this.store.dispatch(new SetSpokenLanguageText(chunk.text));

        // Wait for animation to complete (estimate 4 seconds per chunk)
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }
  }
}
