import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { McpGuardService, VIEW_LOCK_MS } from './mcp-guard.service';

describe('McpGuardService (design 071, review #2)', () => {
  let guard: McpGuardService;
  let time = 1000;

  beforeEach(() => {
    guard = TestBed.inject(McpGuardService);
    time = 1000;
    guard.now = () => time;
  });

  it('locks for a moment after every change of a client', () => {
    expect(guard.locked()).toBe(false);
    guard.changed('left', 'Claude');
    expect(guard.locked()).toBe(true);
    time += VIEW_LOCK_MS - 1;
    expect(guard.locked()).toBe(true);
    guard.changed('right', 'Claude'); // every change starts the lock again
    time += VIEW_LOCK_MS - 1;
    expect(guard.locked()).toBe(true);
    time += 1;
    expect(guard.locked()).toBe(false);
  });

  it('marks stay the client’s until they change – moving the cursor is not enough', () => {
    const marks = new Set(['/a', '/b']);
    guard.changed('left', 'Claude', marks);
    expect(guard.influence('left', marks)).toBe('Claude');
    expect(guard.influence('right', new Set())).toBeNull();
    guard.userTouched('left');
    expect(guard.influence('left', marks)).toBe('Claude');
    expect(guard.client()).toBe('Claude');
    // the user changed the marks: a new set
    const mine = new Set(['/a']);
    guard.marksNow('left', mine);
    expect(guard.influence('left', mine)).toBeNull();
    expect(guard.client()).toBeNull();
  });

  it('cursor and folder stay the client’s until the user touches the panel', () => {
    const none = new Set<string>();
    guard.changed('right', 'Claude', null); // navigate
    expect(guard.influence('right', none)).toBe('Claude');
    guard.marksNow('right', none);
    expect(guard.influence('right', none)).toBe('Claude');
    guard.userTouched('left');
    expect(guard.influence('right', none)).toBe('Claude');
    guard.userTouched('right');
    expect(guard.influence('right', none)).toBeNull();
  });

  it('a cursor change keeps what is known about the marks; forget ends everything', () => {
    const marks = new Set(['/a']);
    guard.changed('left', 'Claude', marks);
    guard.userTouched('left');
    guard.changed('left', 'Claude'); // set_cursor
    guard.userTouched('left');
    expect(guard.influence('left', marks)).toBe('Claude');
    guard.forget('left');
    expect(guard.influence('left', marks)).toBeNull();
    guard.changed('left', 'Claude', marks);
    guard.forget();
    expect(guard.client()).toBeNull();
    expect(guard.locked()).toBe(false);
  });
});
