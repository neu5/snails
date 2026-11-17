import type { ClientMessage, RoomEvent } from './api';

export interface RoomLink {
  /** Sends a message if the socket is open; dropped otherwise (callers resend on reconnect). */
  send(msg: ClientMessage): void;
  stop(): void;
}

/**
 * A room's live socket. Says hello with the player's token (so the server knows who is online),
 * reconnects with a growing delay (a sleeping free server drops sockets), and after every
 * reconnect reports a `room` event so callers reload whatever they missed. `onConnect` runs on
 * each (re)connect, e.g. to resend a turn being streamed.
 */
export function connectRoom(
  roomId: string,
  token: string | null,
  onEvent: (e: RoomEvent) => void,
  onConnect?: () => void,
): RoomLink {
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
      ws!.send(JSON.stringify({ type: 'hello', token } satisfies ClientMessage));
      if (connectedBefore) onEvent({ type: 'room' });
      connectedBefore = true;
      onConnect?.();
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
  return {
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
