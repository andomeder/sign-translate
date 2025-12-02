import {Component, OnInit, PLATFORM_ID, inject, AfterViewInit, CUSTOM_ELEMENTS_SCHEMA} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';

@Component({
  selector: 'app-pose-test',
  standalone: true,
  template: `
    <div style="padding: 20px; font-family: monospace;">
      <h2>Pose Viewer Diagnostic</h2>
      <div>Platform: {{ platform }}</div>
      <div>Window defined: {{ windowDefined }}</div>
      <div>pose-viewer registered: {{ poseViewerRegistered }}</div>
      <div>customElements available: {{ customElementsAvailable }}</div>

      <button (click)="checkStencil()">Check Stencil Status</button>
      <button (click)="manuallyLoadStencil()">Manually Load Stencil</button>

      <pre>{{ diagnosticOutput }}</pre>

      <hr />
      <h3>Test pose-viewer:</h3>
      <div #container style="width: 400px; height: 400px; border: 1px solid red;">
        <pose-viewer
          #poseViewer
          autoplay="true"
          width="100%"
          src="https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_pose?text=hello&spoken=en&signed=ase">
        </pose-viewer>
      </div>
    </div>
  `,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class PoseTestComponent implements OnInit, AfterViewInit {
  private platformId = inject(PLATFORM_ID);

  platform = '';
  windowDefined = false;
  poseViewerRegistered = false;
  customElementsAvailable = false;
  diagnosticOutput = '';

  ngOnInit() {
    this.platform = isPlatformBrowser(this.platformId) ? 'Browser' : 'Server';

    if (isPlatformBrowser(this.platformId)) {
      this.windowDefined = typeof window !== 'undefined';
      this.customElementsAvailable = typeof customElements !== 'undefined';
      this.checkStencil();
    }
  }

  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => {
        this.checkStencil();
        console.log('AfterViewInit check:', this.diagnosticOutput);
      }, 1000);
    }
  }

  checkStencil() {
    if (!isPlatformBrowser(this.platformId)) {
      this.diagnosticOutput = 'Running on server - cannot check';
      return;
    }

    const checks: string[] = [];

    // Check if customElements is defined
    checks.push(`customElements: ${typeof customElements !== 'undefined'}`);

    // Check if pose-viewer is registered
    if (typeof customElements !== 'undefined') {
      const isDefined = customElements.get('pose-viewer');
      this.poseViewerRegistered = !!isDefined;
      checks.push(`pose-viewer registered: ${!!isDefined}`);

      if (isDefined) {
        checks.push(`pose-viewer constructor: ${isDefined.name}`);
      }
    }

    // Check if the element exists in DOM
    const elements = document.querySelectorAll('pose-viewer');
    checks.push(`pose-viewer elements in DOM: ${elements.length}`);

    // Check window.__stencil
    checks.push(`window.__stencil: ${typeof (window as any).__stencil}`);

    this.diagnosticOutput = checks.join('\n');
    console.log('Diagnostic output:', this.diagnosticOutput);
  }

  async manuallyLoadStencil() {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      const module = await import('pose-viewer/loader');
      console.log('Loaded pose-viewer module:', module);

      await module.defineCustomElements(window);
      console.log('Called defineCustomElements');

      setTimeout(() => {
        this.checkStencil();
      }, 500);
    } catch (error) {
      console.error('Error loading Stencil:', error);
      this.diagnosticOutput = `Error: ${error}`;
    }
  }
e
