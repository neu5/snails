import type { RoomEvent } from './api';

/**
 * Listens to a room's live updates over WebSocket. Reconnects with a growing delay (a sleeping
 * free server drops sockets) and reports a `room` event after every reconnect, so callers
 * reload whatever they may have missed. Returns a function that stops listening.
 */
export function listenToRoom(roomId: string, onEvent: (e: RoomEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let delay = 1000;
  let timer = 0;
  let connectedBefore = false;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}`);
    ws.onopen = () => {
      delay = 1000;
      if (connectedBefore) onEvent({ type: 'room' });
      connectedBefore = true;
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as RoomEvent);
      } catch {
        // Ignore anything that is not ours.
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      timer = window.setTimeout(open, delay);
      delay = Math.min(30_000, delay * 2);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
