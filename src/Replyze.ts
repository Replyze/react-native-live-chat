/**
 * Replyze.configure(), show(), identify()... from anywhere in the app. The
 * chat itself is drawn by <ReplyzeHost /> (mounted once, at the root) or by
 * a <ReplyzeChat /> placed in one of your screens; both join this session.
 */
import { resolveOptions, type ReplyzeData, type ReplyzeError, type ReplyzeMessage, type ReplyzeOptions, type ReplyzeUser } from './protocol';
import { ReplyzeSession } from './session';

/** What <ReplyzeHost /> gives the API so show() and hide() can reach it. */
export interface ReplyzeHostHandle {
  show(): void;
  hide(): void;
  isVisible(): boolean;
}

class ReplyzeClient {
  /** The bridge state shared by every chat view. */
  readonly session = new ReplyzeSession();
  private options: ReplyzeOptions | null = null;
  private optionListeners = new Set<() => void>();
  private hosts: ReplyzeHostHandle[] = [];

  /** Once, before the chat is shown (e.g. in your App component). Throws on a bad option. */
  configure(options: ReplyzeOptions): void {
    resolveOptions(options);
    this.options = { ...options };
    for (const listener of [...this.optionListeners]) listener();
  }

  getOptions(): ReplyzeOptions | null {
    return this.options;
  }

  /** Opens the chat full-screen. Needs <ReplyzeHost /> mounted at your app's root. */
  show(): void {
    const host = this.host();
    if (!host) {
      warn('[Replyze] show(): mount <ReplyzeHost /> once at the root of your app first.');
      return;
    }
    host.show();
  }

  hide(): void {
    this.host()?.hide();
  }

  isVisible(): boolean {
    return !!this.host()?.isVisible();
  }

  /** Who the user is. With identity verification, pass userId and the userHash from your server. */
  identify(user: ReplyzeUser): void {
    this.session.identify(user);
  }

  /** The user's custom data: keys matching a contact field fill it, others are kept as extra data; null removes. */
  setData(data: ReplyzeData): void {
    this.session.setData(data);
  }

  /** An event on the user's timeline in the inbox, e.g. pushEvent('Upgraded', { plan: 'pro' }). */
  pushEvent(name: string, data?: ReplyzeData): void {
    this.session.pushEvent(name, data);
  }

  /** The chat's language ("de", "sr", "ar"...), over the device's. */
  setLanguage(language: string): void {
    this.session.setLanguage(language);
  }

  /** Opens the chat on a help article (its id in your knowledge base). Needs the widget's Home or Help tab. */
  openArticle(id: number): void {
    this.session.openArticle(id);
    this.show();
  }

  /** Sends a message as the user. */
  sendMessage(text: string): void {
    this.session.sendMessage(text);
  }

  /** The user signed out of your app: the chat forgets them (call it on logout). */
  reset(): void {
    this.session.reset();
  }

  getUnreadCount(): number {
    return this.session.getUnreadCount();
  }

  /** Unread replies while the chat is closed; returns the unsubscribe function. */
  onUnreadCountChange(listener: (count: number) => void): () => void {
    return this.session.onUnreadCountChange(listener);
  }

  /** Every reply from the AI or the team; returns the unsubscribe function. */
  onMessage(listener: (message: ReplyzeMessage) => void): () => void {
    return this.session.onMessage(listener);
  }

  onError(listener: (error: ReplyzeError) => void): () => void {
    return this.session.onError(listener);
  }

  onIdentified(listener: (result: { verified: boolean }) => void): () => void {
    return this.session.onIdentified(listener);
  }

  // ---- for the components ----

  /** @internal */
  subscribeOptions(listener: () => void): () => void {
    this.optionListeners.add(listener);
    return () => {
      this.optionListeners.delete(listener);
    };
  }

  /** @internal The last mounted host wins (one is expected). */
  registerHost(handle: ReplyzeHostHandle): () => void {
    this.hosts.push(handle);
    return () => {
      this.hosts = this.hosts.filter((h) => h !== handle);
    };
  }

  private host(): ReplyzeHostHandle | null {
    return this.hosts[this.hosts.length - 1] ?? null;
  }
}

function warn(message: string): void {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
  if (dev !== false) console.warn(message);
}

export type { ReplyzeClient };

/** The Replyze API. */
export const Replyze = new ReplyzeClient();
