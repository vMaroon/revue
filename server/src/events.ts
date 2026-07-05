import type { RevueEvent } from '@revue/shared';
import type { EventHub } from './interfaces';

type Subscriber = (event: RevueEvent) => void;

export function createEventHub(): EventHub {
  const subscribers = new Map<string, Set<Subscriber>>();
  return {
    emit(reviewId, event) {
      const set = subscribers.get(reviewId);
      if (!set) return;
      for (const send of set) send(event);
    },
    subscribe(reviewId, send) {
      let set = subscribers.get(reviewId);
      if (!set) {
        set = new Set();
        subscribers.set(reviewId, set);
      }
      set.add(send);
      return () => {
        set.delete(send);
        if (set.size === 0) subscribers.delete(reviewId);
      };
    },
  };
}
