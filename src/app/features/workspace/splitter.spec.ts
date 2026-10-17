import { splitterFromPointer, splitterKey } from './splitter';

describe('splitter', () => {
  it('moves with the arrow keys within the limits', () => {
    expect(splitterKey(0.5, 'ArrowLeft')).toBe(0.48);
    expect(splitterKey(0.5, 'ArrowRight')).toBe(0.52);
    expect(splitterKey(0.16, 'ArrowLeft')).toBe(0.15);
    expect(splitterKey(0.84, 'ArrowRight')).toBe(0.85);
  });

  it('jumps to the limits and back to the middle', () => {
    expect(splitterKey(0.4, 'Home')).toBe(0.15);
    expect(splitterKey(0.4, 'End')).toBe(0.85);
    expect(splitterKey(0.2, 'Enter')).toBe(0.5);
    expect(splitterKey(0.2, 'a')).toBeNull();
  });

  it('maps the pointer position to a bounded ratio', () => {
    expect(splitterFromPointer(300, 100, 800)).toBe(0.25);
    expect(splitterFromPointer(0, 100, 800)).toBe(0.15);
    expect(splitterFromPointer(5000, 100, 800)).toBe(0.85);
    expect(splitterFromPointer(10, 0, 0)).toBe(0.5);
  });
});
