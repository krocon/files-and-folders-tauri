import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FileBrowser } from './features/browser/file-browser';

@Component({
  selector: 'app-root',
  imports: [FileBrowser],
  template: `<main class="shell"><app-file-browser /></main>`,
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
