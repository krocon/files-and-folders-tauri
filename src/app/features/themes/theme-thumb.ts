import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Theme } from '../../core/theme/theme.models';
import { thumbStyle } from './theme-picker-logic';

/**
 * A small picture of a colour scheme (design 070 E4): a dual panel drawn from the scheme's
 * own tokens – header, the selected tab in the colour of its list (069), folder and file rows,
 * a marked row, the cursor and the status line. No image files; own schemes get one too.
 */
@Component({
  selector: 'app-theme-thumb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[style]': 'vars()' },
  template: `
    @for (side of sides; track side) {
      <div class="panel" [class.active]="side === 'left'">
        <div class="head"><span class="crumb"></span></div>
        <div class="tabs"><span class="tab"></span><span class="tab other"></span></div>
        <div class="list">
          <div class="row"><i class="dot folder"></i><span class="bar w60"></span></div>
          <div class="row marked"><i class="dot doc"></i><span class="bar w45"></span></div>
          <div class="row cursor"><i class="dot doc"></i><span class="bar w70"></span></div>
          <div class="row"><i class="dot doc"></i><span class="bar w50"></span></div>
        </div>
        <div class="foot"><span class="bar w40"></span></div>
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      overflow: hidden;
      background: var(--thumb-splitter);
      border-radius: var(--radius-sm);
    }
    .panel {
      display: grid;
      grid-template-rows: 9px 11px 1fr 9px;
      min-width: 0;
      background: var(--thumb-list-bg);
      color: var(--thumb-list-text);
    }
    .panel.active {
      background: var(--thumb-active-list-bg);
      color: var(--thumb-active-list-text);
    }
    .head {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: 0 4px;
      background: var(--thumb-header-bg);
    }
    .crumb {
      width: 45%;
      height: 3px;
      border-radius: 2px;
      background: var(--thumb-header-text);
      opacity: 0.7;
    }
    .tabs {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      padding: 0 4px;
      background: var(--thumb-header-bg);
    }
    .tab {
      width: 30%;
      height: 8px;
      border-radius: 2px 2px 0 0;
      background: var(--thumb-list-bg);
    }
    .active .tab:not(.other) {
      background: var(--thumb-active-panel-tab-bg);
      box-shadow: inset 0 1px 0 var(--thumb-active-panel-accent);
    }
    .tab.other {
      width: 20%;
      height: 3px;
      margin-bottom: 2px;
      background: var(--thumb-tab-text);
      opacity: 0.6;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 3px 0;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 3px;
      height: 7px;
      padding: 0 4px;
    }
    .dot {
      width: 5px;
      height: 5px;
      border-radius: 1px;
      background: var(--thumb-icon-document);
    }
    .dot.folder {
      background: var(--thumb-icon-folder);
    }
    .bar {
      height: 3px;
      border-radius: 2px;
      background: currentColor;
      opacity: 0.85;
    }
    .marked {
      color: var(--thumb-active-marked);
    }
    .panel:not(.active) .cursor {
      /* only the active panel has the cursor in the picture */
      background: none;
    }
    .active .cursor {
      color: var(--thumb-cursor-text);
      background: var(--thumb-cursor-bg);
    }
    .foot {
      display: flex;
      align-items: center;
      padding: 0 4px;
      color: var(--thumb-footer-text);
      background: var(--thumb-footer-bg);
    }
    .w40 {
      width: 40%;
    }
    .w45 {
      width: 45%;
    }
    .w50 {
      width: 50%;
    }
    .w60 {
      width: 60%;
    }
    .w70 {
      width: 70%;
    }
  `,
})
export class ThemeThumb {
  readonly theme = input.required<Pick<Theme, 'tokens' | 'dark'>>();
  protected readonly sides = ['left', 'right'] as const;
  protected readonly vars = computed(() => thumbStyle(this.theme()));
}
