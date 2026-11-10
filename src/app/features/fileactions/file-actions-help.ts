import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { DialogKey } from '../../shared/dialog/dialog-key';
import { Modal } from '../../shared/dialog/modal';
import { FILE_ACTIONS_TEXTS } from './file-actions-texts';

/** Same in every language; the explanations are in the catalog, in this order. */
const PLACEHOLDERS = [
  { code: '%N, %name', example: 'report final.js' },
  { code: '%P%N', example: '/home/marc/docs/report final.js' },
  { code: '%O', example: 'report final' },
  { code: '%E', example: 'js' },
  { code: '%P', example: '/home/marc/docs/' },
  { code: '%T', example: '/backup/' },
  { code: '%%', example: '%' },
] as const;
const EXAMPLES = ['node %N', 'python3 %N --verbose', 'ffmpeg -i %N %O.mp3', 'cp %N %T'] as const;

/** Help of the double-click actions (design 072), opened from their dialog. */
@Component({
  selector: 'app-file-actions-help',
  imports: [Modal, DialogKey],
  template: `
    <app-modal [heading]="t.helpContent.title" width="44rem" (closed)="closed.emit()">
      <div class="content" tabindex="0" data-own-enter>
        <h3>{{ t.helpContent.howHeading }}</h3>
        <p>{{ t.helpContent.how }}</p>

        <h3>{{ t.helpContent.fieldsHeading }}</h3>
        <dl>
          @for (f of t.helpContent.fields; track f.term) {
            <dt>{{ f.term }}</dt>
            <dd>{{ f.text }}</dd>
          }
        </dl>

        <h3>{{ t.helpContent.keysHeading }}</h3>
        <p>{{ t.helpContent.keysExample }}</p>
        <p>{{ t.helpContent.keysNote }}</p>

        <h3>{{ t.helpContent.placeholdersHeading }}</h3>
        <p>{{ t.helpContent.placeholdersIntro }}</p>
        <table>
          <tbody>
            @for (p of placeholders; track p.code; let i = $index) {
              <tr>
                <td class="code">{{ p.code }}</td>
                <td>{{ t.helpContent.placeholders[i] }}</td>
                <td class="code">{{ p.example }}</td>
              </tr>
            }
          </tbody>
        </table>
        <p>{{ t.helpContent.placeholdersNote }}</p>

        <h3>{{ t.helpContent.examplesHeading }}</h3>
        <table>
          <tbody>
            @for (code of examples; track code; let i = $index) {
              <tr>
                <td class="code">{{ code }}</td>
                <td>{{ t.helpContent.examples[i] }}</td>
              </tr>
            }
          </tbody>
        </table>

        <h3>{{ t.helpContent.limitsHeading }}</h3>
        <p>{{ t.helpContent.limits }}</p>
      </div>
      <div class="foot">
        <button appDialogKey="primary" type="button" class="btn primary" (click)="closed.emit()">
          {{ t.helpContent.close }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .content {
      max-height: 65vh;
      overflow: auto;
      font-size: var(--font-size-sm);
    }

    h3 {
      margin: var(--spacing-3) 0 var(--spacing-1);
      font-size: inherit;
      font-weight: 600;

      &:first-child {
        margin-top: 0;
      }
    }

    p {
      margin: 0 0 var(--spacing-1);
    }

    dl {
      margin: 0;
    }

    dt {
      margin-top: var(--spacing-1);
      font-weight: 600;
    }

    dd {
      margin: 0;
    }

    table {
      width: 100%;
      margin-bottom: var(--spacing-1);
      border-collapse: collapse;
    }

    td {
      padding: 2px var(--spacing-2) 2px 0;
      vertical-align: top;
    }

    .code {
      font-family: var(--font-mono);
      overflow-wrap: anywhere;
    }

    .foot {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-2);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileActionsHelp {
  protected readonly t = FILE_ACTIONS_TEXTS;
  protected readonly placeholders = PLACEHOLDERS;
  protected readonly examples = EXAMPLES;
  readonly closed = output<void>();
}
