/**
 * What the GuiExpert Table needs from a browser that jsdom does not have: it observes
 * the size of its host and scrolls its viewport. With these stand-ins the table can be
 * built in a spec – nothing is laid out or painted, but its state (columns, sort, focus)
 * is real. Returns a function that puts back what was there.
 */
export function stubLayoutApis(): () => void {
  const g = globalThis as { ResizeObserver?: unknown };
  const proto = Element.prototype as { scrollTo?: unknown };
  const before = { observer: g.ResizeObserver, scrollTo: proto.scrollTo };
  g.ResizeObserver ??= class {
    readonly observe = (): void => undefined;
    readonly unobserve = (): void => undefined;
    readonly disconnect = (): void => undefined;
  };
  proto.scrollTo ??= (): void => undefined;
  return () => {
    g.ResizeObserver = before.observer;
    proto.scrollTo = before.scrollTo;
  };
}
