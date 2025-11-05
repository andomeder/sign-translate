import {Component, inject, OnInit, PLATFORM_ID} from '@angular/core';
import {isPlatformBrowser} from '@angular/common'; // Import this
import {SpokenLanguageInputComponent} from './spoken-language-input/spoken-language-input.component';
import {SignWritingComponent} from '../signwriting/sign-writing.component';
import {SignedLanguageOutputComponent} from './signed-language-output/signed-language-output.component';
import {Store} from '@ngxs/store';
import {SetSpokenLanguageText} from '../../../modules/translate/translate.actions';

@Component({
  selector: 'app-spoken-to-signed',
  templateUrl: './spoken-to-signed.component.html',
  styleUrls: ['./spoken-to-signed.component.scss'],
  imports: [SpokenLanguageInputComponent, SignWritingComponent, SignedLanguageOutputComponent],
})
export class SpokenToSignedComponent implements OnInit {
  private store = inject(Store);
  private platformId = inject(PLATFORM_ID); // Inject PLATFORM_ID

  ngOnInit(): void {
    // This is the crucial check: only run browser-specific code on the browser.
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('message', event => {
        // Security: Only accept messages from YouTube
        if (event.origin.startsWith('https://www.youtube.com')) {
          const data = event.data;
          if (data && data.type === 'HCI_TRANSLATE') {
            console.log('sign.mt iframe received text via postMessage:', data.text);
            // Dispatch the action to update the text in the app's state
            this.store.dispatch(new SetSpokenLanguageText(data.text));
          }
        }
      });
    }
  }
}
