import { TILE_RETRIES, TileRetries, Timers } from './tile-retries';

function manualTimers(): Timers & { run(): void; count(): number } {
  const queue = new Map<number, () => void>();
  let next = 0;
  return {
    set: (fn) => {
      queue.set(++next, fn);
      return next;
    },
    clear: (h) => void queue.delete(h as number),
    run: () => {
      const fns = [...queue.values()];
      queue.clear();
      fns.forEach((f) => f());
    },
    count: () => queue.size,
  };
}

describe('TileRetries (review 003 #4)', () => {
  it('asks again after a pause, then gives up', () => {
    const timers = manualTimers();
    let changes = 0;
    const r = new TileRetries(10, () => changes++, timers);
    const url = 'cccover://localhost/c1.b.0?v=5';
    expect(r.src(url)).toBe(url);
    for (let n = 1; n <= TILE_RETRIES; n++) {
      r.failed(url);
      expect(r.src(url)).toBeNull(); // the format while waiting
      r.failed(url); // a second error event while waiting counts once
      timers.run();
      expect(changes).toBe(n);
      expect(r.src(url)).toBe(`${url}&retry=${n}`);
    }
    r.failed(url);
    expect(timers.count()).toBe(0);
    expect(r.src(url)).toBeNull();
    expect(r.src('fake:x')).toBe('fake:x');
    r.failed('fake:x');
    timers.run();
    expect(r.src('fake:x')).toBe('fake:x?retry=1');
  });

  it('cancels its timers when disposed', () => {
    const timers = manualTimers();
    const r = new TileRetries(10, () => undefined, timers);
    r.failed('a');
    r.dispose();
    expect(timers.count()).toBe(0);
  });

  it('forgets a failed cover that exists now (design 007 E6)', () => {
    const changes: number[] = [];
    const r = new TileRetries(10, () => changes.push(1), {
      set: () => 1,
      clear: () => undefined,
    });
    for (let i = 0; i < 4; i++) {
      r.failed('u');
    }
    expect(r.src('u')).toBeNull();
    expect(r.forget('u')).toBe(true);
    expect(r.src('u')).toBe('u');
    expect(r.forget('other')).toBe(false);
  });
});
