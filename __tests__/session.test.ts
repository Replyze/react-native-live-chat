import { ReplyzeSession, type ConnectionHandlers } from '../src/session';
import type { HostCommand } from '../src/protocol';

/** A fake WebView: records the commands its injected scripts carry. */
function fakeWebView() {
  const commands: HostCommand[] = [];
  const inject = (script: string) => {
    const received: HostCommand[] = [];
    // eslint-disable-next-line no-new-func
    new Function('window', script)({ ReplyzeApp: { receive: (c: HostCommand) => received.push(c) } });
    commands.push(...received);
  };
  return { commands, inject, cmds: () => commands.map((c) => c.cmd) };
}

const event = (type: string, data?: unknown) => JSON.stringify({ replyze: 1, type, data });

describe('ReplyzeSession', () => {
  let logs: string[];
  let session: ReplyzeSession;

  beforeEach(() => {
    jest.useFakeTimers();
    logs = [];
    session = new ReplyzeSession({ log: (_level, message) => logs.push(message), readyTimeoutMs: 1000 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds commands until the widget is ready, then sends them in the right order', () => {
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    connection.setInsets({ top: 47, bottom: 34 });
    connection.setVisible(true);
    session.pushEvent('Opened app', { build: 12 });
    session.identify({ email: 'ana@shop.example', userId: 7, userHash: 'h' });
    session.setLanguage('de');
    session.setData({ plan: 'pro' });
    session.setData({ seats: 3, plan: 'team' });
    session.openArticle(12);
    expect(web.commands).toEqual([]);
    expect(connection.isReady()).toBe(false);

    connection.receive(event('ready', { version: 1 }));

    expect(connection.isReady()).toBe(true);
    expect(web.commands).toEqual([
      { cmd: 'setInsets', args: { top: 47, bottom: 34 } },
      { cmd: 'setLanguage', args: { language: 'de' } },
      { cmd: 'identify', args: { email: 'ana@shop.example', user_id: 7, user_hash: 'h' } },
      { cmd: 'setData', args: { data: { plan: 'team', seats: 3 } } },
      { cmd: 'open' },
      { cmd: 'pushEvent', args: { name: 'Opened app', data: { build: 12 } } },
      { cmd: 'openArticle', args: { id: 12 } },
    ]);
  });

  it('sends straight away once ready', () => {
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    connection.receive(event('ready'));
    web.commands.length = 0;
    session.identify({ email: 'ana@shop.example' });
    connection.setVisible(true);
    connection.setVisible(false);
    session.sendMessage('Where is my order?');
    expect(web.commands).toEqual([
      { cmd: 'identify', args: { email: 'ana@shop.example' } },
      { cmd: 'open' },
      { cmd: 'close' },
      { cmd: 'sendMessage', args: { text: 'Where is my order?' } },
    ]);
  });

  it('makes a reloaded WebView the same user again', () => {
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    connection.receive(event('ready'));
    session.identify({ userId: 'u1', userHash: 'h1' });
    session.setLanguage('sr');
    session.pushEvent('Paid');
    web.commands.length = 0;

    connection.reloaded();
    expect(connection.isReady()).toBe(false);
    session.pushEvent('Later');
    connection.receive(event('ready'));

    expect(web.cmds()).toEqual(['setLanguage', 'identify', 'close', 'pushEvent']);
    expect(web.commands[3]).toEqual({ cmd: 'pushEvent', args: { name: 'Later' } });
  });

  it('forgets the user on reset, and a reset asked for before ready goes first', () => {
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    session.identify({ email: 'old@shop.example' });
    session.setData({ plan: 'pro' });
    session.pushEvent('Old user event');
    session.reset();
    session.identify({ email: 'new@shop.example' });
    connection.receive(event('ready'));

    expect(web.commands).toEqual([
      { cmd: 'reset' },
      { cmd: 'identify', args: { email: 'new@shop.example' } },
      { cmd: 'close' },
    ]);
  });

  it('a sign-out with no chat view open reaches the next one first, so the next person starts fresh', () => {
    // The user signs out while no chat screen is mounted.
    session.identify({ email: 'old@shop.example' });
    session.reset();
    expect(session.isResetPending()).toBe(true);

    // Later someone opens the chat without signing in.
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    connection.setVisible(true);
    connection.receive(event('ready'));
    expect(web.commands).toEqual([{ cmd: 'reset' }, { cmd: 'open' }]);
    expect(session.isResetPending()).toBe(false);

    // Carried out once: the next chat view (or a reload) doesn't reset the new visitor again.
    connection.reloaded();
    connection.receive(event('ready'));
    const other = fakeWebView();
    session.connect(other.inject).receive(event('ready'));
    expect(web.cmds().filter((c) => c === 'reset')).toHaveLength(1);
    expect(other.cmds()).not.toContain('reset');
  });

  it('a sign-out survives a chat page that reloads or is replaced before it is ready', () => {
    const first = fakeWebView();
    const loading = session.connect(first.inject);
    session.reset();
    // The page reloads (or the view is rebuilt, as a "Try again" does) before it said ready.
    loading.reloaded();
    loading.disconnect();
    const second = fakeWebView();
    session.connect(second.inject).receive(event('ready'));
    expect(second.cmds()[0]).toBe('reset');
    expect(first.commands).toEqual([]);
  });

  it('keeps a sign-out pending when the WebView throws while it is sent', () => {
    let broken = true;
    const commands: string[] = [];
    const flaky = session.connect((script) => {
      if (broken) throw new Error('crashed');
      commands.push(script);
    });
    flaky.receive(event('ready'));
    session.reset();
    expect(session.isResetPending()).toBe(true);
    broken = false;
    flaky.reloaded();
    flaky.receive(event('ready'));
    expect(commands[0]).toContain('"cmd":"reset"');
    expect(session.isResetPending()).toBe(false);
  });

  it('a sign-out a ready chat carried out is not repeated for later views', () => {
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    connection.receive(event('ready'));
    session.reset();
    expect(web.cmds()).toContain('reset');
    expect(session.isResetPending()).toBe(false);
  });

  it('keeps the unread count and tells listeners only about changes', () => {
    const counts: number[] = [];
    const off = session.onUnreadCountChange((n) => counts.push(n));
    const connection = session.connect(fakeWebView().inject);
    connection.receive(event('ready'));
    connection.receive(event('unread', { count: 1 }));
    connection.receive(event('unread', { count: 1 }));
    connection.receive(event('unread', { count: 2 }));
    expect(session.getUnreadCount()).toBe(2);
    session.reset();
    expect(session.getUnreadCount()).toBe(0);
    off();
    connection.receive(event('unread', { count: 5 }));
    expect(counts).toEqual([1, 2, 0]);
  });

  it('passes messages, close, links and errors to the app', () => {
    const handlers: Required<ConnectionHandlers> = {
      onReady: jest.fn(),
      onClose: jest.fn(),
      onOpenUrl: jest.fn(),
      onError: jest.fn(),
    };
    const messages: unknown[] = [];
    const closes: unknown[] = [];
    const errors: unknown[] = [];
    const identified: unknown[] = [];
    session.onMessage((m) => messages.push(m));
    session.onClose(() => closes.push(true));
    session.onError((e) => errors.push(e));
    session.onIdentified((r) => identified.push(r));
    const connection = session.connect(fakeWebView().inject, handlers);

    connection.receive(event('ready'));
    connection.receive(event('message', { id: '5', text: 'Hello', sender: 'agent', senderName: 'Ana', createdAt: null, type: 'text' }));
    connection.receive(event('close'));
    connection.receive(event('openUrl', { url: 'https://shop.example/returns' }));
    connection.receive(event('openUrl', { url: 'javascript:alert(1)' }));
    connection.receive(event('error', { code: 'help_unavailable', message: 'no help' }));
    connection.receive(event('identified', { verified: true }));
    connection.receive(event('log', { level: 'warn', message: '[Replyze] Widget blocked' }));
    connection.receive('{"some":"other page message"}');

    expect(handlers.onReady).toHaveBeenCalledTimes(1);
    expect(messages).toEqual([{ id: '5', text: 'Hello', sender: 'agent', senderName: 'Ana', createdAt: null, type: 'text' }]);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(closes).toHaveLength(1);
    expect(handlers.onOpenUrl).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenUrl).toHaveBeenCalledWith('https://shop.example/returns');
    expect(handlers.onError).toHaveBeenCalledWith({ code: 'help_unavailable', message: 'no help' });
    expect(errors).toEqual([{ code: 'help_unavailable', message: 'no help' }]);
    expect(identified).toEqual([{ verified: true }]);
    expect(logs).toEqual(['[Replyze] Widget blocked']);
  });

  it('reports a chat that never loads, but not one that did', () => {
    const slow = { onError: jest.fn() };
    session.connect(fakeWebView().inject, slow);
    const fast = { onError: jest.fn() };
    const ok = session.connect(fakeWebView().inject, fast);
    ok.receive(event('ready'));
    jest.advanceTimersByTime(1000);
    expect(slow.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'load_timeout' }));
    expect(fast.onError).not.toHaveBeenCalled();
  });

  it('starts the load timer again on reload, and stops it when the view goes', () => {
    const handlers = { onError: jest.fn() };
    const connection = session.connect(fakeWebView().inject, handlers);
    connection.receive(event('ready'));
    connection.reloaded();
    jest.advanceTimersByTime(999);
    expect(handlers.onError).not.toHaveBeenCalled();
    connection.disconnect();
    jest.advanceTimersByTime(10);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('sends to every chat view, and not to one that is gone', () => {
    const a = fakeWebView();
    const b = fakeWebView();
    const ca = session.connect(a.inject);
    const cb = session.connect(b.inject);
    ca.receive(event('ready'));
    cb.receive(event('ready'));
    expect(session.connectionCount).toBe(2);
    cb.disconnect();
    expect(session.connectionCount).toBe(1);
    session.pushEvent('Both?');
    expect(a.commands.some((c) => c.cmd === 'pushEvent')).toBe(true);
    expect(b.commands.some((c) => c.cmd === 'pushEvent')).toBe(false);
    cb.receive(event('unread', { count: 9 }));
    expect(session.getUnreadCount()).toBe(0);
  });

  it('checks what the app passes', () => {
    const web = fakeWebView();
    const connection = session.connect(web.inject);
    connection.receive(event('ready'));
    web.commands.length = 0;
    session.identify({});
    session.pushEvent('   ');
    session.pushEvent('x'.repeat(65));
    session.openArticle(0);
    session.openArticle(1.5);
    session.sendMessage('  ');
    session.setLanguage('');
    session.setData({ nested: { no: true } } as never);
    session.setData({ ok: 'yes', list: [1] } as never);
    expect(web.commands).toEqual([{ cmd: 'setData', args: { data: { ok: 'yes' } } }]);
    expect(logs.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps going when a listener throws', () => {
    const seen: number[] = [];
    session.onUnreadCountChange(() => {
      throw new Error('app bug');
    });
    session.onUnreadCountChange((n) => seen.push(n));
    const connection = session.connect(fakeWebView().inject);
    connection.receive(event('unread', { count: 1 }));
    expect(seen).toEqual([1]);
    expect(logs.some((l) => l.includes('app bug'))).toBe(true);
  });

  it('survives a WebView that throws while being injected into', () => {
    const connection = session.connect(() => {
      throw new Error('gone');
    });
    expect(() => connection.receive(event('ready'))).not.toThrow();
    expect(() => session.pushEvent('x')).not.toThrow();
  });
});
