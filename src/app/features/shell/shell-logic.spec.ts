import {
  historyStep,
  middleEllipsis,
  NO_NAV,
  OutputBuffer,
  remember,
  suggestions,
} from './shell-logic';

describe('shell logic (design 021)', () => {
  const history = ['git status', 'ls -la', 'git log'];

  it('↑/↓ walk the history and bring the draft back', () => {
    let step = historyStep(history, NO_NAV, 'gi', -1)!;
    expect(step.text).toBe('git status');
    step = historyStep(history, step.nav, step.text, -1)!;
    expect(step.text).toBe('ls -la');
    step = historyStep(history, step.nav, step.text, -1)!;
    expect(step.text).toBe('git log');
    expect(historyStep(history, step.nav, step.text, -1)).toBeNull(); // oldest
    step = historyStep(history, step.nav, step.text, 1)!;
    expect(step.text).toBe('ls -la');
    step = historyStep(history, step.nav, step.text, 1)!;
    step = historyStep(history, step.nav, step.text, 1)!;
    expect(step.text).toBe('gi'); // the draft
    expect(step.nav).toEqual(NO_NAV);
    expect(historyStep(history, step.nav, step.text, 1)).toBeNull();
    expect(historyStep([], NO_NAV, 'x', -1)).toBeNull();
  });

  it('suggests history lines by prefix, newest first, without the line itself', () => {
    expect(suggestions(history, 'git')).toEqual(['git status', 'git log']);
    expect(suggestions(history, 'git log')).toEqual([]);
    expect(suggestions(history, '  ')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `echo ${i}`);
    expect(suggestions(many, 'echo')).toHaveLength(8);
  });

  it('remembers like Rust: newest first, no duplicates, bounded', () => {
    expect(remember(history, 'ls -la')).toEqual(['ls -la', 'git status', 'git log']);
    expect(remember(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('shortens the prompt in the middle by characters (emoji stay whole)', () => {
    expect(middleEllipsis('/home/marc', 40)).toBe('/home/marc');
    expect(middleEllipsis('/home/marc/Projekte/files-and-folders-tauri', 20)).toBe(
      '/home/marc…ers-tauri',
    );
    expect(Array.from(middleEllipsis('📁'.repeat(30), 11))).toHaveLength(11);
    expect(middleEllipsis('C:\\Users\\marc\\Documents', 12)).toBe('C:\\Use…ments');
  });

  it('the output merges segments and drops the oldest lines beyond the limits', () => {
    const b = new OutputBuffer(5, 1000);
    b.appendLine('prompt', '/x> ls');
    b.append('stdout', 'a\nb\n');
    b.append('stdout', 'c\n');
    expect(b.segments.map((s) => s.kind)).toEqual(['prompt', 'stdout']);
    expect(b.text()).toBe('/x> ls\na\nb\nc\n');
    b.append('stderr', 'e1\ne2\n');
    expect(b.trimmed).toBe(true);
    expect(b.text()).toBe('a\nb\nc\ne1\ne2\n');
    b.append('stdout', 'kein Zeilenende');
    expect(b.atLineStart()).toBe(false);
    b.appendLine('info', 'Exit code 1');
    expect(b.text().endsWith('kein Zeilenende\nExit code 1\n')).toBe(true);
    // by characters
    const c = new OutputBuffer(1000, 10);
    c.append('stdout', '12345\n67890\nabc\n');
    expect(c.text()).toBe('67890\nabc\n');
    // one line longer than the limit keeps its end
    c.append('stdout', 'x'.repeat(50));
    expect(c.text()).toBe('x'.repeat(10));
    c.clear();
    expect(c.isEmpty && !c.trimmed).toBe(true);
  });
});
