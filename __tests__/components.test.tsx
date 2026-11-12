/**
 * <ReplyzeChat /> and <ReplyzeHost /> with react-native-webview mocked:
 * what the WebView gets, what it is told, and what the app hears.
 */
import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler, Linking, Text } from 'react-native';
import { Replyze, ReplyzeChat, ReplyzeHost } from '../src';

const mockWeb: { props: any; injected: string[]; mounts: number } = { props: null, injected: [], mounts: 0 }; // eslint-disable-line @typescript-eslint/no-explicit-any

jest.mock('react-native-webview', () => {
  const ReactLib = require('react');
  class WebView extends ReactLib.Component {
    injectJavaScript = (script: string) => {
      mockWeb.injected.push(script);
    };
    componentDidMount() {
      mockWeb.mounts += 1;
    }
    render() {
      mockWeb.props = this.props;
      return null;
    }
  }
  return { __esModule: true, default: WebView, WebView };
});

const commands = () =>
  mockWeb.injected.map((script) => {
    const received: unknown[] = [];
    // eslint-disable-next-line no-new-func
    new Function('window', script)({ ReplyzeApp: { receive: (c: unknown) => received.push(c) } });
    return received[0] as { cmd: string; args?: Record<string, unknown> };
  });
const cmdNames = () => commands().map((c) => c.cmd);
const send = (type: string, data?: unknown) =>
  act(() => {
    mockWeb.props.onMessage({ nativeEvent: { data: JSON.stringify({ replyze: 1, type, data }) } });
  });

let renderer: ReactTestRenderer | null = null;
const render = (element: React.ReactElement) => {
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer!;
};

beforeEach(() => {
  mockWeb.props = null;
  mockWeb.injected = [];
  mockWeb.mounts = 0;
  // React Native's preset mocks Linking with jest.fn()s that keep their calls
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  Replyze.reset();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('<ReplyzeChat />', () => {
  it('loads the chat page at baseUrl and opens the chat once the widget is ready', () => {
    render(<ReplyzeChat widgetToken="wgt_comp1" baseUrl="https://shop.example/app" language="de" />);
    expect(mockWeb.props.source.baseUrl).toBe('https://shop.example/app');
    expect(mockWeb.props.source.html).toContain('data-token="wgt_comp1"');
    expect(mockWeb.props.source.html).toContain('data-language="de"');
    expect(mockWeb.props.originWhitelist).toEqual(['*']);
    expect(mockWeb.props.setSupportMultipleWindows).toBe(false);
    expect(mockWeb.injected).toEqual([]);

    send('ready', { version: 1 });
    expect(cmdNames()).toEqual(['open']);
  });

  it('uses Replyze.configure() options, with props on top', () => {
    Replyze.configure({ widgetToken: 'wgt_global', baseUrl: 'https://global.example/app', showCloseButton: false });
    render(<ReplyzeChat baseUrl="https://own.example/app" />);
    expect(mockWeb.props.source.html).toContain('data-token="wgt_global"');
    expect(mockWeb.props.source.html).toContain('data-close-button="false"');
    expect(mockWeb.props.source.baseUrl).toBe('https://own.example/app');
  });

  it('tells the widget when it goes off screen and back, and passes the insets', () => {
    const r = render(<ReplyzeChat widgetToken="wgt_comp1" visible={false} insets={{ top: 47, bottom: 34 }} />);
    send('ready');
    expect(commands()).toEqual([{ cmd: 'setInsets', args: { top: 47, bottom: 34 } }, { cmd: 'close' }]);
    mockWeb.injected = [];
    act(() => r.update(<ReplyzeChat widgetToken="wgt_comp1" visible insets={{ top: 20, bottom: 34 }} />));
    expect(commands()).toEqual([{ cmd: 'open' }, { cmd: 'setInsets', args: { top: 20, bottom: 34 } }]);
  });

  it('keeps the WebView on the chat page and opens links outside', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    render(<ReplyzeChat widgetToken="wgt_comp1" baseUrl="https://shop.example/app" />);
    const should = mockWeb.props.onShouldStartLoadWithRequest;
    expect(should({ url: 'https://shop.example/app', isTopFrame: true })).toBe(true);
    expect(should({ url: 'about:blank' })).toBe(true);
    expect(should({ url: 'https://www.youtube.com/embed/x', isTopFrame: false })).toBe(true);
    expect(should({ url: 'https://shop.example/terms', isTopFrame: true })).toBe(false);
    expect(should({ url: 'javascript:alert(1)', isTopFrame: true })).toBe(false);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://shop.example/terms');

    send('openUrl', { url: 'mailto:help@shop.example' });
    expect(openURL).toHaveBeenLastCalledWith('mailto:help@shop.example');
  });

  it('lets the app open links itself', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const onOpenUrl = jest.fn();
    render(<ReplyzeChat widgetToken="wgt_comp1" onOpenUrl={onOpenUrl} />);
    send('openUrl', { url: 'https://shop.example/terms' });
    expect(onOpenUrl).toHaveBeenCalledWith('https://shop.example/terms');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('passes close, messages and the unread count to its props', () => {
    const onClose = jest.fn();
    const onMessage = jest.fn();
    const onUnreadCountChange = jest.fn();
    const onReady = jest.fn();
    render(<ReplyzeChat widgetToken="wgt_comp1" onClose={onClose} onMessage={onMessage} onUnreadCountChange={onUnreadCountChange} onReady={onReady} />);
    send('ready');
    send('message', { id: '1', text: 'Hi', sender: 'bot', type: 'text' });
    send('unread', { count: 3 });
    send('close');
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: '1', text: 'Hi', sender: 'bot' }));
    expect(onUnreadCountChange).toHaveBeenCalledWith(3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends Replyze.* calls made before the page loaded once it is ready', () => {
    render(<ReplyzeChat widgetToken="wgt_comp1" />);
    // (setLanguage is replayed the same way; it stays set for the whole app, so it is left out here)
    Replyze.identify({ email: 'ana@shop.example', userId: 7, userHash: 'abc' });
    Replyze.pushEvent('Opened chat');
    expect(mockWeb.injected).toEqual([]);
    send('ready');
    expect(commands()).toEqual([
      { cmd: 'identify', args: { email: 'ana@shop.example', user_id: 7, user_hash: 'abc' } },
      { cmd: 'open' },
      { cmd: 'pushEvent', args: { name: 'Opened chat' } },
    ]);
  });

  it('shows a retry when the chat does not load, and loads a new WebView on retry', () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const r = render(<ReplyzeChat widgetToken="wgt_comp1" onError={onError} />);
    expect(mockWeb.mounts).toBe(1);
    act(() => {
      jest.advanceTimersByTime(20000);
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'load_timeout' }));
    const retry = r.root.findAll((n) => n.props.accessibilityRole === 'button')[0];
    expect(r.root.findAllByType(Text).map((t) => t.props.children)).toContain("The chat couldn't load.");
    act(() => retry.props.onPress());
    expect(mockWeb.mounts).toBe(2);
    send('ready');
    expect(r.root.findAllByType(Text).map((t) => t.props.children)).not.toContain("The chat couldn't load.");
  });

  it('reloads with a new WebView when the web process dies, never WebView.reload()', () => {
    render(<ReplyzeChat widgetToken="wgt_comp1" />);
    send('ready');
    act(() => mockWeb.props.onRenderProcessGone({ nativeEvent: { didCrash: true } }));
    expect(mockWeb.mounts).toBe(2);
    mockWeb.injected = [];
    Replyze.identify({ email: 'ana@shop.example' });
    expect(mockWeb.injected).toEqual([]); // waits for the new page
    send('ready');
    expect(cmdNames()).toEqual(['identify', 'open']);
  });

  it('reports bad options instead of crashing', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = jest.fn();
    render(<ReplyzeChat widgetToken="bad token" onError={onError} />);
    expect(mockWeb.props).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_options' }));
    expect(error).toHaveBeenCalled();
  });
});

describe('<ReplyzeHost />', () => {
  it('loads hidden, opens with Replyze.show(), closes with back or the close button', () => {
    const handlers: Array<() => boolean | null | undefined> = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    });
    Replyze.configure({ widgetToken: 'wgt_host1' });
    render(<ReplyzeHost />);
    expect(mockWeb.mounts).toBe(1); // preloaded
    send('ready');
    expect(cmdNames()).toEqual(['close']);
    expect(Replyze.isVisible()).toBe(false);

    mockWeb.injected = [];
    act(() => Replyze.show());
    expect(Replyze.isVisible()).toBe(true);
    expect(cmdNames()).toEqual(['open']);
    expect(handlers).toHaveLength(1);

    mockWeb.injected = [];
    let handled: boolean | null | undefined;
    act(() => {
      handled = handlers[0]();
    });
    expect(handled).toBe(true);
    expect(Replyze.isVisible()).toBe(false);
    expect(cmdNames()).toEqual(['close']);
    expect(handlers).toHaveLength(0);

    act(() => Replyze.show());
    send('close');
    expect(Replyze.isVisible()).toBe(false);
  });

  it('waits for the first show() when not preloaded', () => {
    Replyze.configure({ widgetToken: 'wgt_host1' });
    render(<ReplyzeHost preload={false} />);
    expect(mockWeb.mounts).toBe(0);
    act(() => Replyze.show());
    expect(mockWeb.mounts).toBe(1);
    send('ready');
    expect(cmdNames()).toEqual(['open']);
  });

  it('opens on a help article', () => {
    Replyze.configure({ widgetToken: 'wgt_host1' });
    render(<ReplyzeHost />);
    send('ready');
    mockWeb.injected = [];
    act(() => Replyze.openArticle(12));
    expect(commands()).toEqual([{ cmd: 'openArticle', args: { id: 12 } }, { cmd: 'open' }]);
  });
});
