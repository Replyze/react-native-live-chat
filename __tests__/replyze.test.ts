import { Replyze, type ReplyzeHostHandle } from '../src/Replyze';
import { ReplyzeConfigError } from '../src/protocol';

describe('Replyze', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('checks the options when configured, and tells the views', () => {
    expect(() => Replyze.configure({ widgetToken: 'nope!' })).toThrow(ReplyzeConfigError);
    const seen: unknown[] = [];
    const off = Replyze.subscribeOptions(() => seen.push(Replyze.getOptions()));
    Replyze.configure({ widgetToken: 'wgt_abc123', baseUrl: 'https://shop.example/app' });
    off();
    Replyze.configure({ widgetToken: 'wgt_other1' });
    expect(seen).toEqual([{ widgetToken: 'wgt_abc123', baseUrl: 'https://shop.example/app' }]);
    expect(Replyze.getOptions()).toEqual({ widgetToken: 'wgt_other1' });
  });

  it('warns when show() has no host to open', () => {
    Replyze.show();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('<ReplyzeHost />'));
    expect(Replyze.isVisible()).toBe(false);
  });

  it('shows and hides through the mounted host; the last one mounted wins', () => {
    const make = () => {
      let shown = false;
      const handle: ReplyzeHostHandle = { show: () => (shown = true), hide: () => (shown = false), isVisible: () => shown };
      return handle;
    };
    const first = make();
    const second = make();
    const offFirst = Replyze.registerHost(first);
    const offSecond = Replyze.registerHost(second);
    Replyze.show();
    expect(second.isVisible()).toBe(true);
    expect(first.isVisible()).toBe(false);
    expect(Replyze.isVisible()).toBe(true);
    Replyze.hide();
    expect(Replyze.isVisible()).toBe(false);
    offSecond();
    Replyze.openArticle(4);
    expect(first.isVisible()).toBe(true);
    offFirst();
  });

  it('sends commands to the chat views through its session', () => {
    const scripts: string[] = [];
    const connection = Replyze.session.connect((s) => scripts.push(s));
    connection.receive(JSON.stringify({ replyze: 1, type: 'ready' }));
    scripts.length = 0;
    Replyze.identify({ email: 'ana@shop.example' });
    Replyze.setData({ plan: 'pro' });
    Replyze.pushEvent('Upgraded', { plan: 'pro' });
    Replyze.setLanguage('fr');
    Replyze.sendMessage('Hi');
    Replyze.reset();
    expect(scripts.map((s) => /"cmd":"(\w+)"/.exec(s)?.[1])).toEqual(['identify', 'setData', 'pushEvent', 'setLanguage', 'sendMessage', 'reset']);

    const counts: number[] = [];
    const off = Replyze.onUnreadCountChange((n) => counts.push(n));
    connection.receive(JSON.stringify({ replyze: 1, type: 'unread', data: { count: 2 } }));
    expect(Replyze.getUnreadCount()).toBe(2);
    expect(counts).toEqual([2]);
    off();
    connection.disconnect();
  });
});
