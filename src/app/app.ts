import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Workspace } from './features/workspace/workspace';

@Component({
  selector: 'app-root',
  imports: [Workspace],
  template: `<app-workspace class="shell" />`,
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
