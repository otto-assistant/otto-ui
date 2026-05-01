/**
 * OttoSyncClient — WebSocket sync layer for Otto UI.
 * Connects to the Otto backend event hub and dispatches real-time events.
 */

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export interface SyncEvent {
  id: string;
  type: string; // e.g. "task.created", "agent.status_changed"
  payload: unknown;
  timestamp: number;
}

export interface OptimisticUpdate<T = unknown> {
  id: string;
  rollback: () => void;
  resolve: (confirmed: T) => void;
}

type EventHandler = (event: SyncEvent) => void;
type ConnectionHandler = (state: ConnectionState) => void;

interface Subscription {
  pattern: string;
  regex: RegExp;
  handler: EventHandler;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export class OttoSyncClient {
  private ws: WebSocket | null = null;
  private subscriptions: Subscription[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private optimisticUpdates = new Map<string, OptimisticUpdate>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private _state: ConnectionState = 'disconnected';
  private _lastEventId: string | null = null;
  private url: string;
  private destroyed = false;

  get state(): ConnectionState {
    return this._state;
  }

  get lastEventId(): string | null {
    return this._lastEventId;
  }

  constructor(url?: string) {
    const wsProtocol = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = globalThis.location?.host ?? 'localhost:3000';
    this.url = url ?? `${wsProtocol}//${host}/ws/events`;
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;

    try {
      const connectUrl = this._lastEventId
        ? `${this.url}?lastEventId=${encodeURIComponent(this._lastEventId)}`
        : this.url;

      this.ws = new WebSocket(connectUrl);
      this.ws.onopen = this.handleOpen;
      this.ws.onclose = this.handleClose;
      this.ws.onerror = this.handleError;
      this.ws.onmessage = this.handleMessage;
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleOpen = () => {
    this.reconnectDelay = 1000;
    this.setState('connected');
  };

  private handleClose = () => {
    this.ws = null;
    if (!this.destroyed) {
      this.setState('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
    }
  };

  private handleError = () => {
    this.ws?.close();
  };

  private handleMessage = (msg: MessageEvent) => {
    try {
      const event: SyncEvent = JSON.parse(msg.data as string);
      this._lastEventId = event.id;

      // Check if this confirms/rejects an optimistic update
      if (event.type.endsWith('.confirmed')) {
        const updateId = (event.payload as { updateId?: string })?.updateId;
        if (updateId && this.optimisticUpdates.has(updateId)) {
          this.optimisticUpdates.get(updateId)!.resolve(event.payload);
          this.optimisticUpdates.delete(updateId);
        }
      } else if (event.type.endsWith('.rejected')) {
        const updateId = (event.payload as { updateId?: string })?.updateId;
        if (updateId && this.optimisticUpdates.has(updateId)) {
          this.optimisticUpdates.get(updateId)!.rollback();
          this.optimisticUpdates.delete(updateId);
        }
      }

      // Dispatch to matching subscribers
      for (const sub of this.subscriptions) {
        if (sub.regex.test(event.type)) {
          sub.handler(event);
        }
      }
    } catch {
      // Ignore malformed messages
    }
  };

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  private setState(state: ConnectionState) {
    if (this._state === state) return;
    this._state = state;
    for (const handler of this.connectionHandlers) {
      handler(state);
    }
  }

  /** Subscribe to events matching a glob pattern (e.g. "task.*") */
  on(pattern: string, handler: EventHandler): () => void {
    const sub: Subscription = { pattern, regex: patternToRegex(pattern), handler };
    this.subscriptions.push(sub);
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
    };
  }

  /** Subscribe to connection state changes */
  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.push(handler);
    handler(this._state);
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter((h) => h !== handler);
    };
  }

  /** Register an optimistic update that can be rolled back */
  optimistic<T = unknown>(id: string, rollback: () => void): Promise<T> {
    return new Promise<T>((resolve) => {
      this.optimisticUpdates.set(id, { id, rollback, resolve: resolve as (v: unknown) => void });
    });
  }

  /** Send a message to the server */
  send(type: string, payload: unknown, optimisticId?: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload, optimisticId }));
    }
  }

  /** Tear down the connection permanently */
  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.subscriptions = [];
    this.connectionHandlers = [];
    this.optimisticUpdates.clear();
  }
}

let singleton: OttoSyncClient | null = null;

export function getOttoSyncClient(url?: string): OttoSyncClient {
  if (!singleton) {
    singleton = new OttoSyncClient(url);
  }
  return singleton;
}
