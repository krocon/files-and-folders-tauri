import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MenuBar } from './features/menus/menu-bar';
import { Workspace } from './features/workspace/workspace';

@Component({
  selector: 'app-root',
  imports: [Workspace, MenuBar],
  // the menu bar shows itself only where the OS has no native one (design 014 E5)
  template: `<app-menu-bar /><app-workspace class="shell" />`,
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
