import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { JobTable } from './job-table';
import { JobRow } from './job-rows';

const row = (amount: string): JobRow => ({
  id: 'j1',
  state: 'queued',
  status: 'Waiting',
  finished: false,
  problem: false,
  amount,
  speed: '',
  percent: null,
  action: 'Delete',
  current: '',
  buttons: [],
});

/**
 * Every repaint rebuilds all cells. A button replaced between mouse down and mouse up gets
 * no `click` – with a running task (10 repaints a second) most clicks were lost.
 */
describe('JobTable', () => {
  function setup() {
    TestBed.overrideComponent(JobTable, {
      set: {
        imports: [],
        template: '<button type="button" data-job="j1" data-slot="start"></button>',
      },
    });
    const fixture = TestBed.createComponent(JobTable);
    fixture.componentRef.setInput('rows', [row('1 GB')]);
    const api = { setRows: vi.fn(), repaintHard: vi.fn(), subscribe: vi.fn(() => () => undefined) };
    (fixture.componentInstance as unknown as { api: { set(a: unknown): void } }).api.set(api);
    fixture.detectChanges();
    api.setRows.mockClear();
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector('button')!;
    const setRows = (amount: string) => {
      fixture.componentRef.setInput('rows', [row(amount)]);
      fixture.detectChanges();
    };
    const tick = () => new Promise((r) => setTimeout(r));
    return { api, host, button, setRows, tick };
  }

  it('repaints at once while no button is pressed', () => {
    const { api, setRows } = setup();
    setRows('2 GB');
    expect(api.setRows).toHaveBeenCalledTimes(1);
  });

  it('holds new rows from pressing a button until after the click, then shows the latest', async () => {
    const { api, button, setRows, tick } = setup();
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    setRows('2 GB');
    setRows('3 GB');
    expect(api.setRows).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerup'));
    // the click comes right after the release: still the same button
    expect(api.setRows).not.toHaveBeenCalled();
    await tick();
    expect(api.setRows).toHaveBeenCalledTimes(1);
    expect(api.setRows.mock.calls[0][0][0].amount).toBe('3 GB');
    setRows('4 GB');
    expect(api.setRows).toHaveBeenCalledTimes(2);
  });

  it('pressing elsewhere in the table does not hold anything', () => {
    const { api, host, setRows } = setup();
    host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    setRows('2 GB');
    expect(api.setRows).toHaveBeenCalledTimes(1);
  });

  it.each(['pointercancel', 'blur'])('%s ends the hold', async (type) => {
    const { api, button, setRows, tick } = setup();
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    setRows('2 GB');
    window.dispatchEvent(new Event(type));
    await tick();
    expect(api.setRows).toHaveBeenCalledTimes(1);
  });

  it('the focus leaving another element does not end the hold (only the window losing it)', async () => {
    const { api, button, setRows, tick } = setup();
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // pressing moves the focus: the blur of the old element passes the window in the capture phase
    button.dispatchEvent(new FocusEvent('blur'));
    await tick();
    setRows('2 GB');
    expect(api.setRows).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerup'));
    await tick();
    expect(api.setRows).toHaveBeenCalledTimes(1);
  });

  it('Space activates on key up: holds from key down to key up', async () => {
    const { api, button, setRows, tick } = setup();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    setRows('2 GB');
    expect(api.setRows).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    await tick();
    expect(api.setRows).toHaveBeenCalledTimes(1);
  });
});
