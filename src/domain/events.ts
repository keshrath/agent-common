// =============================================================================
// agent-common — Event bus
//
// In-process pub/sub with wildcard subscribers. Consumer-defined event types
// are passed as a generic parameter for type safety.
// =============================================================================

export interface BusEvent<T extends string = string> {
  type: T;
  timestamp: string;
  data: Record<string, unknown>;
}

export type EventHandler<T extends string = string> = (event: BusEvent<T>) => void;

export class EventBus<T extends string = string> {
  private readonly listeners = new Map<T | '*', Set<EventHandler<T>>>();

  emit(type: T, data: Record<string, unknown> = {}): void {
    const event: BusEvent<T> = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    const specific = this.listeners.get(type);
    if (specific) {
      for (const handler of specific) {
        try {
          handler(event);
        } catch (err) {
          process.stderr.write(
            '[agent-common] Event listener error (' +
              type +
              '): ' +
              (err instanceof Error ? err.message : String(err)) +
              '\n',
          );
        }
      }
    }

    const wildcards = this.listeners.get('*');
    if (wildcards) {
      for (const handler of wildcards) {
        try {
          handler(event);
        } catch (err) {
          process.stderr.write(
            '[agent-common] Wildcard listener error (' +
              type +
              '): ' +
              (err instanceof Error ? err.message : String(err)) +
              '\n',
          );
        }
      }
    }
  }

  on(type: T | '*', handler: EventHandler<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
