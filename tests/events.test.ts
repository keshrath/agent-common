import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/domain/events.js';

type T = 'a' | 'b';

describe('EventBus', () => {
  it('delivers to specific listeners', () => {
    const bus = new EventBus<T>();
    const fn = vi.fn();
    bus.on('a', fn);
    bus.emit('a', { x: 1 });
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0][0].data).toEqual({ x: 1 });
  });

  it('delivers to wildcard listeners', () => {
    const bus = new EventBus<T>();
    const fn = vi.fn();
    bus.on('*', fn);
    bus.emit('a');
    bus.emit('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus<T>();
    const fn = vi.fn();
    const off = bus.on('a', fn);
    off();
    bus.emit('a');
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeAll clears all listeners', () => {
    const bus = new EventBus<T>();
    const fn = vi.fn();
    bus.on('*', fn);
    bus.removeAll();
    bus.emit('a');
    expect(fn).not.toHaveBeenCalled();
  });
});
