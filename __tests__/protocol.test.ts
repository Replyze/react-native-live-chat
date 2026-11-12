import {
  buildChatHtml,
  commandScript,
  DEFAULT_API_URL,
  DEFAULT_BASE_URL,
  DEFAULT_CDN_URL,
  identifyCommand,
  insetsCommand,
  isChatPage,
  isExternalUrl,
  parseEvent,
  parseOrigin,
  ReplyzeConfigError,
  resolveOptions,
  type HostCommand,
} from '../src/protocol';

describe('resolveOptions', () => {
  it('fills in the defaults', () => {
    expect(resolveOptions({ widgetToken: ' wgt_abc123 ' })).toEqual({
      widgetToken: 'wgt_abc123',
      baseUrl: DEFAULT_BASE_URL,
      apiUrl: DEFAULT_API_URL,
      cdnUrl: DEFAULT_CDN_URL,
      language: null,
      tracking: true,
      showCloseButton: true,
      pageTitle: 'In-app chat',
    });
  });

  it('keeps what the app sets and trims trailing slashes off the API and CDN', () => {
    const o = resolveOptions({
      widgetToken: 'wgt_abc123',
      baseUrl: 'https://shop.example/app',
      apiUrl: 'https://api.shop.example/',
      cdnUrl: 'https://cdn.shop.example//',
      language: 'pt-BR',
      tracking: false,
      showCloseButton: false,
      pageTitle: 'Shop app',
    });
    expect(o.apiUrl).toBe('https://api.shop.example');
    expect(o.cdnUrl).toBe('https://cdn.shop.example');
    expect(o.baseUrl).toBe('https://shop.example/app');
    expect(o.language).toBe('pt-BR');
    expect(o.tracking).toBe(false);
    expect(o.showCloseButton).toBe(false);
    expect(o.pageTitle).toBe('Shop app');
  });

  it.each([undefined, '', 'x', 'wgt bad', 'wgt_<script>', 'a'.repeat(129)])('refuses the token %p', (widgetToken) => {
    expect(() => resolveOptions({ widgetToken: widgetToken as string })).toThrow(ReplyzeConfigError);
  });

  it('refuses no options at all', () => {
    expect(() => resolveOptions(null)).toThrow(/widgetToken/);
  });

  it.each([
    ['baseUrl', 'http://shop.example'],
    ['baseUrl', 'shop.example'],
    ['baseUrl', 'javascript:alert(1)'],
    ['apiUrl', 'https://user:pass@api.example'],
    ['cdnUrl', 'ftp://cdn.example'],
    ['cdnUrl', 'https://cdn.example/"><script>'],
  ])('refuses %s %p', (key, value) => {
    expect(() => resolveOptions({ widgetToken: 'wgt_abc123', [key]: value })).toThrow(ReplyzeConfigError);
  });

  it('allows plain http for a backend on the developer machine', () => {
    expect(resolveOptions({ widgetToken: 'wgt_abc123', apiUrl: 'http://10.0.2.2:8000' }).apiUrl).toBe('http://10.0.2.2:8000');
    expect(resolveOptions({ widgetToken: 'wgt_abc123', cdnUrl: 'http://localhost:5173' }).cdnUrl).toBe('http://localhost:5173');
  });

  it('refuses a language that is not a code', () => {
    expect(() => resolveOptions({ widgetToken: 'wgt_abc123', language: 'german!' })).toThrow(/language/);
  });
});

describe('parseOrigin', () => {
  it('reads scheme, host and origin without the URL class', () => {
    expect(parseOrigin('https://Shop.Example:8443/app?x=1#y')).toEqual({ scheme: 'https', host: 'shop.example', origin: 'https://shop.example:8443' });
    expect(parseOrigin('https://user@shop.example')).toBeNull();
    expect(parseOrigin('mailto:a@b.c')).toBeNull();
  });
});

describe('buildChatHtml', () => {
  const html = buildChatHtml(
    resolveOptions({
      widgetToken: 'wgt_abc123',
      baseUrl: 'https://shop.example/app',
      language: 'de',
      pageTitle: 'Shop "app" <b>',
    }),
  );

  it('loads widget.js in in-app mode with data attributes', () => {
    expect(html).toContain(
      '<script src="https://cdn.replyze.chat/widget.js" data-token="wgt_abc123" data-embedded="app" data-api-url="https://client.replyze.chat" data-language="de"></script>',
    );
    expect(html).toContain('<html lang="de">');
  });

  it('has no inline script and a CSP that allows scripts from the CDN only', () => {
    const scripts = html.match(/<script\b[^>]*>/g) || [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('src="https://cdn.replyze.chat/widget.js"');
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('script-src https://cdn.replyze.chat;');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('http:');
  });

  it('is safe-area aware and does not zoom on focus', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('maximum-scale=1');
  });

  it('escapes what goes into the page', () => {
    expect(html).toContain('<title>Shop &quot;app&quot; &lt;b&gt;</title>');
    expect(html).not.toContain('<b>');
  });

  it('switches tracking and close buttons off by attribute', () => {
    const off = buildChatHtml(resolveOptions({ widgetToken: 'wgt_abc123', tracking: false, showCloseButton: false }));
    expect(off).toContain('data-tracking="false"');
    expect(off).toContain('data-close-button="false"');
    expect(html).not.toContain('data-tracking');
  });

  it('allows http and ws only for a local backend', () => {
    const local = buildChatHtml(resolveOptions({ widgetToken: 'wgt_abc123', apiUrl: 'http://localhost:8000' }));
    expect(local).toMatch(/connect-src https: wss: http: ws:/);
  });
});

describe('commandScript', () => {
  function run(command: HostCommand): unknown[] {
    const received: unknown[] = [];
    const window = { ReplyzeApp: { receive: (c: unknown) => received.push(c) } };
    // eslint-disable-next-line no-new-func
    const result = new Function('window', `return ${commandScript(command).replace(/;true;$/, ';')}`)(window);
    expect(result).toBeUndefined();
    return received;
  }

  it('hands the command to window.ReplyzeApp.receive as an object', () => {
    expect(run({ cmd: 'openArticle', args: { id: 12 } })).toEqual([{ cmd: 'openArticle', args: { id: 12 } }]);
  });

  it('survives quotes, script tags and line separators in the text', () => {
    const text = `He said "hi" </script><script>alert(1)</script> ${String.fromCharCode(0x2028)} ${String.fromCharCode(0x2029)} \\ '`;
    expect(run({ cmd: 'sendMessage', args: { text } })).toEqual([{ cmd: 'sendMessage', args: { text } }]);
    expect(commandScript({ cmd: 'sendMessage', args: { text } })).not.toContain(String.fromCharCode(0x2028));
  });

  it('does nothing before the widget has loaded', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function('window', commandScript({ cmd: 'open' }))({})).not.toThrow();
  });

  it('ends in true for injectJavaScript', () => {
    expect(commandScript({ cmd: 'close' }).endsWith('true;')).toBe(true);
  });
});

describe('parseEvent', () => {
  const ev = (type: string, data?: unknown) => JSON.stringify({ replyze: 1, type, data });

  it('reads each event', () => {
    expect(parseEvent(ev('ready', { version: 1 }))).toEqual({ type: 'ready', version: 1 });
    expect(parseEvent(ev('close'))).toEqual({ type: 'close' });
    expect(parseEvent(ev('unread', { count: 3 }))).toEqual({ type: 'unread', count: 3 });
    expect(parseEvent(ev('identified', { verified: true }))).toEqual({ type: 'identified', verified: true });
    expect(parseEvent(ev('openUrl', { url: 'https://shop.example/terms' }))).toEqual({ type: 'openUrl', url: 'https://shop.example/terms' });
    expect(parseEvent(ev('error', { code: 'help_unavailable', message: 'x' }))).toEqual({ type: 'error', error: { code: 'help_unavailable', message: 'x' } });
    expect(parseEvent(ev('log', { level: 'warn', message: '[Replyze] x' }))).toEqual({ type: 'log', level: 'warn', message: '[Replyze] x' });
    expect(parseEvent(ev('message', { id: '9', text: 'Hi', sender: 'agent', senderName: 'Ana', createdAt: '2026-11-08T10:00:00Z', type: 'text' }))).toEqual({
      type: 'message',
      message: { id: '9', text: 'Hi', sender: 'agent', senderName: 'Ana', createdAt: '2026-11-08T10:00:00Z', type: 'text' },
    });
  });

  it('accepts an object as well as a string', () => {
    expect(parseEvent({ replyze: 1, type: 'close' })).toEqual({ type: 'close' });
  });

  it('cleans up odd values', () => {
    expect(parseEvent(ev('unread', { count: -4 }))).toEqual({ type: 'unread', count: 0 });
    expect(parseEvent(ev('unread', { count: 'many' }))).toEqual({ type: 'unread', count: 0 });
    expect(parseEvent(ev('message', { id: 9, text: { html: 1 }, sender: 'visitor' }))).toEqual({
      type: 'message',
      message: { id: '', text: '', sender: 'bot', senderName: null, createdAt: null, type: 'text' },
    });
  });

  it('ignores anything that is not a Replyze event', () => {
    expect(parseEvent('not json')).toBeNull();
    expect(parseEvent(JSON.stringify({ type: 'close' }))).toBeNull();
    expect(parseEvent(JSON.stringify({ replyze: 2, type: 'close' }))).toBeNull();
    expect(parseEvent(ev('somethingElse'))).toBeNull();
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent(42)).toBeNull();
  });

  it('drops links the app must not open', () => {
    expect(parseEvent(ev('openUrl', { url: 'javascript:alert(1)' }))).toBeNull();
    expect(parseEvent(ev('openUrl', { url: 'file:///etc/passwd' }))).toBeNull();
    expect(parseEvent(ev('openUrl', { url: 'intent://scan/#Intent;scheme=zxing;end' }))).toBeNull();
    expect(parseEvent(ev('openUrl', {}))).toBeNull();
  });
});

describe('links and navigation', () => {
  it('opens web, mail, phone and sms links outside', () => {
    for (const url of ['https://a.example', 'http://a.example', 'mailto:a@b.example', 'tel:+381601234567', 'sms:+38160']) {
      expect(isExternalUrl(url)).toBe(true);
    }
    for (const url of ['javascript:void(0)', 'file:///x', 'data:text/html,x', 'myapp://x', '//a.example']) {
      expect(isExternalUrl(url)).toBe(false);
    }
  });

  it('lets the WebView load only the chat page', () => {
    const base = 'https://shop.example/app';
    expect(isChatPage('https://shop.example/app', base)).toBe(true);
    expect(isChatPage('https://shop.example/app/', base)).toBe(true);
    expect(isChatPage('https://shop.example/app#x', base)).toBe(true);
    expect(isChatPage('about:blank', base)).toBe(true);
    expect(isChatPage('', base)).toBe(true);
    expect(isChatPage('https://shop.example/', base)).toBe(false);
    expect(isChatPage('https://evil.example/app', base)).toBe(false);
  });
});

describe('commands from the app', () => {
  it('maps the camelCase user to the widget identify', () => {
    expect(identifyCommand({ email: ' ana@shop.example ', name: 'Ana', userId: 42, userHash: 'abc' })).toEqual({
      cmd: 'identify',
      args: { email: 'ana@shop.example', name: 'Ana', user_id: 42, user_hash: 'abc' },
    });
    expect(identifyCommand({ userId: ' u-1 ' })).toEqual({ cmd: 'identify', args: { user_id: 'u-1' } });
    expect(identifyCommand({ userHash: 'abc' })).toBeNull();
    expect(identifyCommand({})).toBeNull();
  });

  it('rounds insets and keeps them positive', () => {
    expect(insetsCommand({ top: 47.4, bottom: -3, left: Number.NaN })).toEqual({ cmd: 'setInsets', args: { top: 47, bottom: 0 } });
    expect(insetsCommand(null)).toEqual({ cmd: 'setInsets', args: {} });
  });
});
