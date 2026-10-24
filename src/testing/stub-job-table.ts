import { Component, input, output } from '@angular/core';
import type { JobAct, JobRow } from '../app/features/jobs/job-rows';

/**
 * Same inputs/outputs as `JobTable`, without the GuiExpert Table – it needs a layout
 * (ResizeObserver) that jsdom has not. Use with
 * `TestBed.overrideComponent(JobListDialog, { remove: { imports: [JobTable] }, add: { imports: [StubJobTable] } })`.
 */
@Component({ selector: 'app-job-table', template: '{{ rows().length }} rows' })
export class StubJobTable {
  readonly rows = input.required<readonly JobRow[]>();
  readonly selectedId = input<string | null>(null);
  readonly act = output<{ id: string; act: JobAct }>();
  readonly rowClick = output<string>();
}
