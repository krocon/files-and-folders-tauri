import { EMPTY_PROGRESS } from '../../core/jobs/jobs.models';
import { job } from '../../../testing/fake-jobs-api';
import { formatDuration, fraction, jobTitle, progressText, stateLabel } from './job-format';

describe('job format', () => {
  it('titles jobs by kind', () => {
    expect(jobTitle(job('j', { kind: 'copy', sources: ['/a/b'], targetDir: '/z' }))).toBe(
      'Copy /a/b → /z',
    );
    expect(jobTitle(job('j', { kind: 'copy', sources: ['/a', '/b'], targetDir: '/z' }))).toBe(
      'Copy 2 entries → /z',
    );
    expect(
      jobTitle(
        job('j', {
          kind: 'move',
          sources: ['/a/b'],
          targetDir: '/a',
          options: { renameTo: 'c' },
        }),
      ),
    ).toBe('Move /a/b → /a as c');
    expect(jobTitle(job('j', { kind: 'delete', paths: ['/a', '/b'], mode: 'trash' }))).toBe(
      'Move 2 entries to the trash',
    );
    expect(jobTitle(job('j', { kind: 'delete', paths: ['/a'], mode: 'permanent' }))).toBe(
      'Delete /a permanently',
    );
    expect(stateLabel('waitingForDecision')).toBe('Waiting for your answer');
  });

  it('computes progress from bytes, else items', () => {
    expect(fraction(EMPTY_PROGRESS)).toBeNull();
    expect(fraction({ ...EMPTY_PROGRESS, bytesDone: 1, bytesTotal: 4 })).toBe(0.25);
    expect(fraction({ ...EMPTY_PROGRESS, itemsDone: 3, itemsTotal: 4 })).toBe(0.75);
  });

  it('shows size, rate and time left', () => {
    const p = {
      ...EMPTY_PROGRESS,
      bytesDone: 1024 * 1024,
      bytesTotal: 3 * 1024 * 1024,
      rateBps: 1024 * 1024,
    };
    expect(progressText(p)).toBe('1.0 MB of 3.0 MB · 1.0 MB/s · 0:02 left');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(progressText(p, false)).toBe('1.0 MB of 3.0 MB'); // paused: no stale rate
  });
});
