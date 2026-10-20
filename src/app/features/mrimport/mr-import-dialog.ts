import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { MrTool } from '../../core/mrimport/mr-import.models';
import { AreaPlan, MrAreaId } from './mr-import-logic';
import { MR_IMPORT_TEXTS } from './mr-import-texts';
import { MrImportStore } from './mr-import.store';

/**
 * Import from Files and Folders (old version) – design 026 E13: folder → preview per area
 * (count, conflicts, what cannot be transferred and why) → import of the checked areas.
 */
@Component({
  selector: 'app-mr-import-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.title" width="46rem" (closed)="store.close()">
      <div class="tool">
        <div class="body">
          <p class="intro">{{ t.intro }}</p>
          <div class="row">
            <label class="field grow">
              <span>{{ t.folder }}</span>
              <input
                type="text"
                class="folder"
                data-autofocus
                spellcheck="false"
                [attr.aria-describedby]="helpId"
                [value]="store.path()"
                (input)="store.path.set(value($event))"
                (keydown.enter)="find($event)"
              />
            </label>
            <button
              type="button"
              class="btn"
              [disabled]="store.busy() || !store.path().trim()"
              (click)="store.find()"
            >
              {{ t.search }}
            </button>
          </div>
          <p class="help" [id]="helpId">{{ t.folderHelp }}</p>
          @if (store.plans().length > 0) {
            <fieldset class="areas">
              <legend>{{ t.areasLegend }}</legend>
              @for (p of store.plans(); track p.area) {
                <div class="area">
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="store.chosen().has(p.area)"
                      [disabled]="!selectable(p)"
                      [attr.aria-describedby]="summaryId(p.area)"
                      (change)="store.toggle(p.area, checked($event))"
                    />
                    <span>{{ areaName(p.area) }}</span>
                  </label>
                  <span class="summary" [id]="summaryId(p.area)">{{ summary(p) }}</span>
                  @if (p.area === 'tools' && toolItems().length > 0) {
                    <!-- review 026 #1: every tool with program and arguments, chosen one by one -->
                    <ul class="tools" [attr.aria-label]="t.areaNames.tools">
                      @for (tool of toolItems(); track tool.id) {
                        <li>
                          <label class="check">
                            <input
                              type="checkbox"
                              [checked]="store.chosenTools().has(tool.id)"
                              [disabled]="store.busy()"
                              (change)="store.toggleTool(tool.id, checked($event))"
                            />
                            <span>{{ tool.label }}</span>
                          </label>
                          <span class="mono">{{ commandLine(tool) }}</span>
                          @if (tool.shortcut) {
                            <span class="muted">{{ tool.shortcut }}</span>
                          }
                        </li>
                      }
                    </ul>
                  }
                  @if (p.area === 'tools' && p.count > 0) {
                    <p class="warn" role="note">{{ t.toolsWarning }}</p>
                  }
                  @if (p.conflicts.length > 0 || p.skipped.length > 0) {
                    <details>
                      <summary>{{ t.details }}</summary>
                      @if (p.conflicts.length > 0) {
                        <p class="sub">{{ t.conflictsHeading }}</p>
                        <ul>
                          @for (c of p.conflicts; track $index) {
                            <li>{{ store.conflictText(p.area, c) }}</li>
                          }
                        </ul>
                      }
                      @if (p.skipped.length > 0) {
                        <p class="sub">{{ t.skippedHeading }}</p>
                        <ul>
                          @for (s of p.skipped; track $index) {
                            <li>
                              <span class="mono">{{ s.item }}</span> – {{ t.reasons[s.reason] }}
                            </li>
                          }
                        </ul>
                      }
                    </details>
                  }
                </div>
              }
            </fieldset>
            <fieldset class="mode">
              <legend>{{ t.modeLegend }}</legend>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-mri-mode"
                  [checked]="store.mode() === 'merge'"
                  (change)="store.mode.set('merge')"
                />
                <span>{{ t.merge }}</span>
              </label>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-mri-mode"
                  [checked]="store.mode() === 'replace'"
                  (change)="store.mode.set('replace')"
                />
                <span>{{ t.replace }}</span>
              </label>
            </fieldset>
            <p class="help">{{ t.modeHelp }} {{ t.backupsNote }}</p>
          }
        </div>
        <p class="status" aria-live="polite">{{ store.message() }}</p>
        <p class="error" role="alert">{{ store.error() }}</p>
        <div class="foot">
          <div class="buttons">
            <button type="button" class="btn" (click)="store.close()">{{ t.close }}</button>
            <button
              type="button"
              class="btn primary"
              [disabled]="!store.canImport()"
              (click)="store.run()"
            >
              {{ t.importButton }}
            </button>
          </div>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './mr-import-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MrImportDialog {
  protected readonly t = MR_IMPORT_TEXTS;
  protected readonly store = inject(MrImportStore);
  protected readonly helpId = 'fnf-mri-help';

  protected summaryId(area: MrAreaId): string {
    return `fnf-mri-sum-${area}`;
  }

  protected areaName(area: MrAreaId): string {
    const scan = this.store.scan();
    return area === 'shortcuts' && scan
      ? this.t.shortcutsOf(this.t.osNames[scan.os])
      : this.t.areaNames[area];
  }

  protected selectable(p: AreaPlan): boolean {
    if (p.area === 'tools') {
      return this.toolItems().length > 0 && !this.store.busy();
    }
    return p.count > 0 && p.apply !== null && !this.store.busy();
  }

  protected toolItems(): readonly MrTool[] {
    const tools = this.store.scan()?.tools;
    return tools && !tools.error ? tools.items : [];
  }

  /** Program and arguments as they will be started (no shell – shown for checking). */
  protected commandLine(tool: MrTool): string {
    return [tool.program, ...tool.args].join(' ');
  }

  /** "3 to import · 1 conflict · 2 not transferred · 5 unchanged". */
  protected summary(p: AreaPlan): string {
    if (p.file === null) {
      return this.t.notFoundArea;
    }
    if (p.error) {
      return this.t.reasons[p.error];
    }
    const parts = [
      p.count > 0 || (p.area === 'tools' && this.toolItems().length > 0)
        ? this.t.toImport(p.count)
        : this.t.nothingNew,
    ];
    if (p.conflicts.length > 0) {
      parts.push(this.t.conflicts(p.conflicts.length));
    }
    const skipped = p.skipped.length + p.skippedMore;
    if (skipped > 0) {
      parts.push(this.t.skipped(skipped));
    }
    if (p.unchanged > 0) {
      parts.push(this.t.unchanged(p.unchanged));
    }
    return parts.join(' · ');
  }

  protected find(evt: Event): void {
    evt.preventDefault();
    void this.store.find();
  }

  protected value(evt: Event): string {
    return (evt.target as HTMLInputElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }
}
