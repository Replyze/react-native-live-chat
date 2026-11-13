/**
 * The SDK and the real widget, end to end: the page the SDK builds runs the
 * widget bundle in jsdom, the widget's posts go to this package's session,
 * and the session's scripts are evaluated in the page, as
 * react-native-webview does. Only the Replyze API is faked.
 */
import fs from 'fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildChatHtml, resolveOptions } from '../src/protocol';
import { ReplyzeSession, type Connection } from '../src/session';

const bundle = fs.readFileSync(process.env.REPLYZE_WIDGET_JS as string, 'utf8');
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

interface ApiCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

const CONFIG = {
  widget: { color: '#0e7490', bot_name: 'Ava', pre_chat_form: false },
  features: { home_tab: true, help_tab: true, search: false },
  ws: null,
};

function api(url: string, method: string): unknown {
  if (url.endsWith('/config')) return CONFIG;
  if (url.endsWith('/session/start')) {
    return { session_id: '0', contact_id: '5', visitor_key: 'vk_5', channel_key: 'ck_5', messages: [], ...CONFIG };
  }
  if (url.endsWith('/identify')) {
    return { contact_id: '5', visitor_key: 'vk_5', channel_key: 'ck_5', email: 'ana@shop.example', name: 'Ana', verified: true, switched: false, form_data: [] };
  }
  if (/\/kb\/articles\/\d+$/.test(url)) {
    return { id: 12, title: 'Returns', content: 'Send it back within 30 days.', excerpt: null, category_id: null, helpful_count: 0, not_helpful_count: 0 };
  }
  if (/\/kb\/(categories|articles)/.test(url)) return [];
  if (method === 'POST') return {};
  return {};
}

/** Pages to close after each test: the widget's timers would keep Jest running. */
const pages: JSDOM[] = [];
afterEach(() => {
  while (pages.length) pages.pop()!.window.close();
});

function boot(session: ReplyzeSession, handlers: Parameters<ReplyzeSession['connect']>[1]) {
  const options = resolveOptions({
    widgetToken: 'wgt_e2e',
    baseUrl: 'https://shop.example/app',
    apiUrl: 'https://api.replyze.test',
    cdnUrl: 'https://cdn.replyze.test',
    language: 'de',
  });
  const dom = new JSDOM(buildChatHtml(options), {
    url: options.baseUrl,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    // jsdom can't parse the widget's nested CSS; that noise isn't the test's
    virtualConsole: new VirtualConsole(),
  });
  pages.push(dom);
  const w = dom.window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  // What jsdom doesn't draw
  w.Element.prototype.scrollTo = () => undefined;
  w.Element.prototype.scrollIntoView = () => undefined;
  const calls: ApiCall[] = [];
  w.fetch = async (input: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url: String(input), body: init.body ? JSON.parse(init.body) : null });
    const body = api(String(input), method);
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  };
  // react-native-webview: injectJavaScript evaluates in the page, postMessage comes back as onMessage.
  const connection: Connection = session.connect((script) => w.eval(script), handlers);
  w.ReactNativeWebView = { postMessage: (data: string) => connection.receive(data) };
  return { w, calls, connection, start: () => w.eval(bundle) };
}

describe('the SDK with the real widget', () => {
  it('identifies, follows visibility, counts unread replies and passes events', async () => {
    const logs: string[] = [];
    const session = new ReplyzeSession({ log: (_l, m) => logs.push(m), readyTimeoutMs: 0 });
    const handlers = { onReady: jest.fn(), onClose: jest.fn(), onOpenUrl: jest.fn(), onError: jest.fn() };
    const verified: unknown[] = [];
    const messages: unknown[] = [];
    const unread: number[] = [];
    session.onIdentified((r) => verified.push(r));
    session.onMessage((m) => messages.push(m));
    session.onUnreadCountChange((n) => unread.push(n));

    const { w, calls, connection, start } = boot(session, handlers);
    // Before the page loads, as an app would on launch
    session.identify({ email: 'ana@shop.example', name: 'Ana', userId: 42, userHash: 'f00d' });
    session.setData({ plan: 'pro' });
    connection.setInsets({ top: 47, bottom: 34 });
    connection.setVisible(true);

    start();
    await tick(60);

    expect(handlers.onReady).toHaveBeenCalledTimes(1);
    expect(connection.isReady()).toBe(true);
    const host = w.document.getElementById('aichat-widget') as HTMLElement;
    expect(host.classList.contains('rz-app')).toBe(true);
    expect(host.getAttribute('lang')).toBe('de');
    expect(host.style.getPropertyValue('--rz-inset-top')).toBe('47px');
    expect(host.style.getPropertyValue('--rz-inset-bottom')).toBe('34px');

    // identify with a hash makes a contact first, then the verified identify
    const identify = calls.find((c) => c.method === 'POST' && c.url === 'https://api.replyze.test/api/w/wgt_e2e/identify');
    expect(identify?.body).toEqual(expect.objectContaining({ contact_id: '5', email: 'ana@shop.example', name: 'Ana', user_id: '42', user_hash: 'f00d' }));
    expect(verified).toEqual([{ verified: true }]);
    await tick(400); // setData is flushed after 300 ms
    const data = calls.find((c) => c.url.endsWith('/data'));
    expect(data?.body).toEqual(expect.objectContaining({ data: { plan: 'pro' } }));

    // A reply while the chat is on screen: no unread
    const widget = w.Replyze._widget;
    widget.handleIncomingMessage({ message: { id: 101, content: 'Hi Ana!', sender_type: 'agent', sender_name: 'Marko', created_at: '2026-11-08T10:00:00Z' } });
    expect(messages).toEqual([{ id: '101', text: 'Hi Ana!', sender: 'agent', senderName: 'Marko', createdAt: '2026-11-08T10:00:00Z', type: 'text' }]);
    expect(unread).toEqual([]);

    // The app hides the chat: replies now count, and showing it clears them
    connection.setVisible(false);
    widget.handleIncomingMessage({ message: { id: 102, content: 'Your refund is on its way.', sender_type: 'agent', sender_name: 'Marko', created_at: '2026-11-08T10:01:00Z' } });
    widget.handleIncomingMessage({ message: { id: 103, content: 'Anything else?', sender_type: 'bot', created_at: '2026-11-08T10:02:00Z' } });
    expect(unread).toEqual([1, 2]);
    expect(session.getUnreadCount()).toBe(2);
    expect(handlers.onClose).not.toHaveBeenCalled(); // the app's own close is not echoed
    connection.setVisible(true);
    expect(unread).toEqual([1, 2, 0]);

    // The visitor taps close
    const close = host.shadowRoot!.querySelector('.rz-home-close, .aichat-header-close') as HTMLElement;
    close.dispatchEvent(new w.MouseEvent('click', { bubbles: true, composed: true }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    // A link in the chat goes to the app
    const link = w.document.createElement('a');
    link.href = 'https://shop.example/returns';
    link.target = '_blank';
    host.shadowRoot!.appendChild(link);
    link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(handlers.onOpenUrl).toHaveBeenCalledWith('https://shop.example/returns');

    // A help article, a language and an event
    calls.length = 0;
    session.openArticle(12);
    session.setLanguage('sr');
    session.pushEvent('Opened help', { from: 'settings' });
    await tick(400);
    expect(calls.some((c) => c.url.includes('/kb/articles/12'))).toBe(true);
    expect(host.getAttribute('lang')).toBe('sr');
    const events = calls.find((c) => c.url.endsWith('/events'));
    expect(JSON.stringify(events?.body)).toContain('Opened help');
    expect(handlers.onError).not.toHaveBeenCalled();

    // Sign-out: the widget forgets the visitor
    session.reset();
    expect(w.localStorage.getItem('aichat_visitor_key')).toBeNull();
    expect(logs.filter((l) => !l.startsWith('[Replyze]'))).toEqual([]);
  });

  it('a sign-out while no chat was open: the next person who opens it sees nothing of the previous user', async () => {
    const session = new ReplyzeSession({ log: () => undefined, readyTimeoutMs: 0 });
    // The previous user signed out while no chat view was mounted.
    session.identify({ email: 'ana@shop.example', userId: 42, userHash: 'f00d' });
    session.reset();

    // The next person opens the chat without signing in. The WebView still
    // has Ana's chat in its storage, and the API would give it back to her key.
    const { w, calls, start } = boot(session, {});
    w.localStorage.setItem('aichat_session', JSON.stringify({ session_id: '77', contact_id: '5', token: 'wgt_e2e', created_at: Date.now() }));
    w.localStorage.setItem('aichat_contact_id', '5');
    w.localStorage.setItem('aichat_visitor_key', 'vk_5');
    w.localStorage.setItem('aichat_channel_key', 'ck_5');
    const keys: Array<string | null> = [];
    w.fetch = async (input: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
      const method = init.method || 'GET';
      const url = String(input);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method, url, body });
      keys.push(init.headers?.['X-Visitor-Key'] ?? null);
      let answer = api(url, method);
      if (url.endsWith('/session/start')) {
        answer = body?.contact_id === '5' && init.headers?.['X-Visitor-Key'] === 'vk_5'
          ? { ...CONFIG, session_id: 77, contact_id: '5', visitor_key: 'vk_5', channel_key: 'ck_5', messages: [{ id: '901', content: 'ANA-SECRET my order 1042', sender: 'visitor', created_at: '2026-11-08T10:00:00Z' }] }
          : { ...CONFIG, session_id: 0, contact_id: '6', visitor_key: 'vk_6', channel_key: 'ck_6', messages: [] };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(answer), json: async () => answer };
    };

    // When the session's scripts carry the reset: whatever the page sends after it is the new person's.
    let afterReset = -1;
    const evaluate = w.eval.bind(w);
    w.eval = (script: string) => {
      if (script.includes('"cmd":"reset"') && afterReset === -1) afterReset = calls.length;
      return evaluate(script);
    };
    start();
    await tick(100);
    session.sendMessage('Hello, I am new here');
    await tick(100);

    const host = w.document.getElementById('aichat-widget') as HTMLElement;
    const shown = host.shadowRoot!.textContent + JSON.stringify(w.Replyze._widget.messages);
    expect(shown).not.toContain('ANA-SECRET');
    expect(w.localStorage.getItem('aichat_visitor_key')).not.toBe('vk_5');
    // The session's pending reset ran as the page became ready. Ana's contact
    // and key went out only before it (the restore it cancelled), never after.
    expect(afterReset).toBeGreaterThan(0);
    const message = calls.find((c) => c.url.endsWith('/message'));
    expect(message?.body).toEqual(expect.objectContaining({ content: 'Hello, I am new here' }));
    expect(calls.slice(afterReset).some((c) => c.body?.contact_id === '5')).toBe(false);
    expect(keys.slice(afterReset)).not.toContain('vk_5');
  });

  it('tells the app when an article cannot be shown', async () => {
    const session = new ReplyzeSession({ log: () => undefined, readyTimeoutMs: 0 });
    const errors: unknown[] = [];
    session.onError((e) => errors.push(e));
    const { start } = boot(session, {});
    CONFIG.features = { home_tab: false, help_tab: false, search: false };
    try {
      start();
      await tick(60);
      session.openArticle(12);
      expect(errors).toEqual([expect.objectContaining({ code: 'help_unavailable' })]);
    } finally {
      CONFIG.features = { home_tab: true, help_tab: true, search: false };
    }
  });
});
