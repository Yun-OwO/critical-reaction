export type GameEvent = 'state-changed' | 'reaction' | 'damage' | 'extraction' | 'boss' | 'dye' | 'death' | 'electron' | 'room' | 'treasure' | 'run' | 'special';
type Listener = (payload?: unknown) => void;

const listeners = new Map<GameEvent, Set<Listener>>();

export function on(event: GameEvent, listener: Listener): () => void {
  const eventListeners = listeners.get(event) ?? new Set<Listener>();
  eventListeners.add(listener);
  listeners.set(event, eventListeners);
  return () => eventListeners.delete(listener);
}

export function emit(event: GameEvent, payload?: unknown): void {
  listeners.get(event)?.forEach((listener) => listener(payload));
}
