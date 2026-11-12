/**
 * The app's side of the bridge, without React Native: commands wait until
 * the widget says it is ready, who the user is (identify, language, data)
 * is sent again whenever a WebView (re)loads, and the unread count and the
 * widget's events reach the app's listeners.
 */
import {
  commandScript,
  identifyCommand,
  insetsCommand,
  parseEvent,
  type HostCommand,
  type Insets,
  type ReplyzeData,
  type ReplyzeError,
  type ReplyzeMessage,
  type ReplyzeUser,
  type WidgetEvent,
} from './protocol';

/** Runs JavaScript in one WebView (react-native-webview's injectJavaScript). */
export type Injector = (script: string) => void;

/** What one chat view hears from its WebView. */
export interface ConnectionHandlers {
  onReady?: () => void;
  /** The visitor tapped close in the chat. */
  onClose?: () => void;
  onOpenUrl?: (url: string) => void;
  onError?: (error: ReplyzeError) => void;
}

export interface Connection {
  /** A message from the WebView (onMessage's event.nativeEvent.data). */
  receive(raw: unknown): void;
  /** Whether the chat is on screen: messages then count as read. */
  setVisible(visible: boolean): void;
  setInsets(insets: Partial<Insets> | null): void;
  /** The WebView started loading again: wait for the next ready. */
  reloaded(): void;
  isReady(): boolean;
  /** The view is gone. */
  disconnect(): void;
}

type Listener<T> = (value: T) => void;

interface Listeners {
  unread: Set<Listener<number>>;
  message: Set<Listener<ReplyzeMessage>>;
  close: Set<Listener<void>>;
  ready: Set<Listener<void>>;
  error: Set<Listener<ReplyzeError>>;
  identified: Set<Listener<{ verified: boolean }>>;
}

export interface SessionOptions {
  /** How long a WebView may take to say it is ready, in ms (default 20000). */
  readyTimeoutMs?: number;
  /** Where the widget's warnings go (default console.warn in development). */
  log?: (level: string, message: string) => void;
}

const MAX_QUEUE = 100;
/** Commands whose latest value the session keeps and replays on every ready. */
const STICKY = new Set<HostCommand['cmd']>(['identify', 'setLanguage', 'setData']);

class WebViewConnection implements Connection {
  private ready = false;
  private queue: HostCommand[] = [];
  private visible = false;
  private insets: HostCommand | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private gone = false;
  private pendingReset = false;

  constructor(
    private readonly session: ReplyzeSession,
    private readonly inject: Injector,
    private readonly handlers: ConnectionHandlers,
    private readonly timeoutMs: number,
  ) {
    this.startTimer();
  }

  receive(raw: unknown): void {
    if (this.gone) return;
    const event = parseEvent(raw);
    if (!event) return;
    if (event.type === 'ready') {
      this.becomeReady();
      return;
    }
    this.session.handleEvent(event, this.handlers);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.ready) this.run({ cmd: visible ? 'open' : 'close' });
  }

  setInsets(insets: Partial<Insets> | null): void {
    this.insets = insets ? insetsCommand(insets) : null;
    if (this.ready && this.insets) this.run(this.insets);
  }

  reloaded(): void {
    if (this.gone) return;
    this.ready = false;
    this.startTimer();
  }

  isReady(): boolean {
    return this.ready;
  }

  disconnect(): void {
    this.gone = true;
    this.clearTimer();
    this.queue = [];
    this.session.forget(this);
  }

  /** A command for the widget: now, or once it is ready. */
  send(command: HostCommand): void {
    if (this.gone) return;
    if (this.ready) {
      this.run(command);
    } else if (command.cmd === 'reset') {
      // Goes first when the widget is ready, before the new user's state.
      this.pendingReset = true;
    } else if (STICKY.has(command.cmd)) {
      // Sent with the session's latest state when ready (no duplicates).
    } else if (this.queue.length < MAX_QUEUE) {
      this.queue.push(command);
    }
  }

  /** reset(): what waited for the old user is dropped. */
  dropQueue(): void {
    this.queue = [];
  }

  private becomeReady(): void {
    this.clearTimer();
    this.ready = true;
    // The page started over: a sign-out asked for meanwhile, the app's
    // insets, who the user is, whether the chat is on screen, then the rest.
    if (this.pendingReset) this.run({ cmd: 'reset' });
    this.pendingReset = false;
    if (this.insets) this.run(this.insets);
    for (const command of this.session.stickyCommands()) this.run(command);
    this.run({ cmd: this.visible ? 'open' : 'close' });
    const queued = this.queue;
    this.queue = [];
    for (const command of queued) this.run(command);
    this.handlers.onReady?.();
    this.session.emitReady();
  }

  private run(command: HostCommand): void {
    try {
      this.inject(commandScript(command));
    } catch {
      // The WebView is going away; the next ready replays what matters.
    }
  }

  private startTimer(): void {
    this.clearTimer();
    if (this.timeoutMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.ready || this.gone) return;
      const error = { code: 'load_timeout', message: 'The chat did not load. Check the connection and the widget token.' };
      this.handlers.onError?.(error);
      this.session.emitError(error);
    }, this.timeoutMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class ReplyzeSession {
  private connections = new Set<WebViewConnection>();
  private identity: HostCommand | null = null;
  private language: HostCommand | null = null;
  private data: ReplyzeData = {};
  private unread = 0;
  private listeners: Listeners = {
    unread: new Set(),
    message: new Set(),
    close: new Set(),
    ready: new Set(),
    error: new Set(),
    identified: new Set(),
  };

  constructor(private readonly options: SessionOptions = {}) {}

  /** A WebView joins: it gets every command from now on, and the user's state when ready. */
  connect(inject: Injector, handlers: ConnectionHandlers = {}): Connection {
    const connection = new WebViewConnection(this, inject, handlers, this.options.readyTimeoutMs ?? 20000);
    this.connections.add(connection);
    return connection;
  }

  /** How many WebViews are attached (one per mounted chat view). */
  get connectionCount(): number {
    return this.connections.size;
  }

  identify(user: ReplyzeUser): void {
    const command = identifyCommand(user);
    if (!command) {
      this.log('warn', '[Replyze] identify: give an email, a name or a userId.');
      return;
    }
    this.identity = command;
    this.broadcast(command);
  }

  setData(data: ReplyzeData): void {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const clean: ReplyzeData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) clean[key] = value;
      else this.log('warn', `[Replyze] setData: "${key}" must be text, a number, true/false or null.`);
    }
    if (!Object.keys(clean).length) return;
    // Kept merged, for a WebView that loads later; null removes the key there too.
    this.data = { ...this.data, ...clean };
    this.broadcast({ cmd: 'setData', args: { data: clean } });
  }

  pushEvent(name: string, data?: ReplyzeData): void {
    const eventName = typeof name === 'string' ? name.trim() : '';
    if (!eventName || eventName.length > 64) {
      this.log('warn', '[Replyze] pushEvent: the name must be 1 to 64 characters.');
      return;
    }
    this.broadcast({ cmd: 'pushEvent', args: data ? { name: eventName, data } : { name: eventName } });
  }

  setLanguage(language: string): void {
    if (typeof language !== 'string' || !language.trim()) return;
    this.language = { cmd: 'setLanguage', args: { language: language.trim() } };
    this.broadcast(this.language);
  }

  openArticle(id: number): void {
    if (!Number.isInteger(id) || id <= 0) {
      this.log('warn', '[Replyze] openArticle: the article id must be a positive whole number.');
      return;
    }
    this.broadcast({ cmd: 'openArticle', args: { id } });
  }

  sendMessage(text: string): void {
    if (typeof text !== 'string' || !text.trim()) return;
    this.broadcast({ cmd: 'sendMessage', args: { text } });
  }

  /** The user signed out: forget them in the chat too (a new visitor from now on). */
  reset(): void {
    this.identity = null;
    this.data = {};
    for (const connection of this.connections) connection.dropQueue();
    this.broadcast({ cmd: 'reset' });
    this.setUnread(0);
  }

  getUnreadCount(): number {
    return this.unread;
  }

  onUnreadCountChange(listener: Listener<number>): () => void {
    return this.subscribe('unread', listener);
  }

  onMessage(listener: Listener<ReplyzeMessage>): () => void {
    return this.subscribe('message', listener);
  }

  /** The visitor tapped close in a chat. */
  onClose(listener: Listener<void>): () => void {
    return this.subscribe('close', listener);
  }

  onReady(listener: Listener<void>): () => void {
    return this.subscribe('ready', listener);
  }

  onError(listener: Listener<ReplyzeError>): () => void {
    return this.subscribe('error', listener);
  }

  onIdentified(listener: Listener<{ verified: boolean }>): () => void {
    return this.subscribe('identified', listener);
  }

  // ---- for the connections ----

  /** What a freshly loaded WebView needs to be the same user. */
  stickyCommands(): HostCommand[] {
    const commands: HostCommand[] = [];
    if (this.language) commands.push(this.language);
    if (this.identity) commands.push(this.identity);
    if (Object.keys(this.data).length) commands.push({ cmd: 'setData', args: { data: { ...this.data } } });
    return commands;
  }

  handleEvent(event: Exclude<WidgetEvent, { type: 'ready' }>, handlers: ConnectionHandlers): void {
    switch (event.type) {
      case 'close':
        handlers.onClose?.();
        this.emit('close', undefined);
        break;
      case 'unread':
        this.setUnread(event.count);
        break;
      case 'message':
        this.emit('message', event.message);
        break;
      case 'identified':
        this.emit('identified', { verified: event.verified });
        break;
      case 'openUrl':
        handlers.onOpenUrl?.(event.url);
        break;
      case 'error':
        handlers.onError?.(event.error);
        this.emit('error', event.error);
        break;
      case 'log':
        this.log(event.level, event.message);
        break;
    }
  }

  emitReady(): void {
    this.emit('ready', undefined);
  }

  emitError(error: ReplyzeError): void {
    this.emit('error', error);
  }

  forget(connection: WebViewConnection): void {
    this.connections.delete(connection);
  }

  private broadcast(command: HostCommand): void {
    for (const connection of this.connections) connection.send(command);
  }

  private setUnread(count: number): void {
    if (count === this.unread) return;
    this.unread = count;
    this.emit('unread', count);
  }

  private subscribe<K extends keyof Listeners>(kind: K, listener: Listeners[K] extends Set<infer L> ? L : never): () => void {
    const set = this.listeners[kind] as Set<unknown>;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  private emit<K extends keyof Listeners>(kind: K, value: Listeners[K] extends Set<Listener<infer T>> ? T : never): void {
    for (const listener of [...(this.listeners[kind] as Set<Listener<unknown>>)]) {
      try {
        listener(value);
      } catch (error) {
        this.log('warn', `[Replyze] A ${kind} listener threw: ${String(error)}`);
      }
    }
  }

  private log(level: string, message: string): void {
    if (this.options.log) {
      this.options.log(level, message);
      return;
    }
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    if (dev !== false) console.warn(message);
  }
}
