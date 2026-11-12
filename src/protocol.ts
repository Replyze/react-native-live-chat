/**
 * The page the chat runs in and the bridge to it. No React Native here, so
 * this is what the unit tests cover. The widget's side of the bridge is
 * the widget's in-app mode (data-embedded="app" in widget.js).
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_API_URL = 'https://client.replyze.chat';
export const DEFAULT_CDN_URL = 'https://cdn.replyze.chat';
/**
 * The page address when the app gives none: fine while the widget has no
 * allowed-domains list. With a list, use a URL on one of its domains.
 */
export const DEFAULT_BASE_URL = 'https://cdn.replyze.chat/in-app';
export const DEFAULT_PAGE_TITLE = 'In-app chat';

export interface ReplyzeOptions {
  /** The widget's embed token, "wgt_..." (Settings → Integrations → Install widget). */
  widgetToken: string;
  /**
   * The address the chat page runs at: the inbox shows it as the visitor's
   * page and the Replyze API sees its domain as the Origin. When the widget
   * has an allowed-domains list, use a URL on one of those domains, e.g.
   * "https://yourshop.com/app". Nothing is loaded from it.
   */
  baseUrl?: string;
  /** The Replyze API (default https://client.replyze.chat). */
  apiUrl?: string;
  /** Where widget.js is served from (default https://cdn.replyze.chat). */
  cdnUrl?: string;
  /** The interface language ("de", "sr", "pt-BR"...); default: the device's, or the widget's setting. */
  language?: string;
  /** Visitor presence (the Visitors page, "online now"). Default true. */
  tracking?: boolean;
  /** The close buttons in the chat. Default true; false when the chat is one of your own screens. */
  showCloseButton?: boolean;
  /** The page title the team sees next to the conversation. Default "In-app chat". */
  pageTitle?: string;
}

export interface ResolvedOptions {
  widgetToken: string;
  baseUrl: string;
  apiUrl: string;
  cdnUrl: string;
  language: string | null;
  tracking: boolean;
  showCloseButton: boolean;
  pageTitle: string;
}

/** Who the visitor is. With identity verification on, user_hash is the HMAC-SHA256 your server computes. */
export interface ReplyzeUser {
  email?: string;
  name?: string;
  /** Your own id for this user; with userHash, the same contact on every device. */
  userId?: string | number;
  /** HMAC-SHA256(userId, or email without one, the widget's identity secret), hex. Compute it on your server. */
  userHash?: string;
}

export type ReplyzeData = Record<string, string | number | boolean | null>;

export interface ReplyzeMessage {
  id: string;
  text: string;
  sender: 'bot' | 'agent';
  senderName: string | null;
  createdAt: string | null;
  /** "text", or e.g. "rating_request" for the rating card */
  type: string;
}

export interface ReplyzeError {
  /** load_timeout, help_unavailable, unknown_command, invalid_options */
  code: string;
  message: string;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type HostCommand =
  | { cmd: 'open' }
  | { cmd: 'close' }
  | { cmd: 'identify'; args: { email?: string; name?: string; user_id?: string | number; user_hash?: string } }
  | { cmd: 'setData'; args: { data: ReplyzeData } }
  | { cmd: 'pushEvent'; args: { name: string; data?: ReplyzeData } }
  | { cmd: 'setLanguage'; args: { language: string } }
  | { cmd: 'openArticle'; args: { id: number } }
  | { cmd: 'sendMessage'; args: { text: string } }
  | { cmd: 'reset' }
  | { cmd: 'setInsets'; args: Partial<Insets> };

export type WidgetEvent =
  | { type: 'ready'; version: number }
  | { type: 'close' }
  | { type: 'unread'; count: number }
  | { type: 'message'; message: ReplyzeMessage }
  | { type: 'identified'; verified: boolean }
  | { type: 'openUrl'; url: string }
  | { type: 'error'; error: ReplyzeError }
  | { type: 'log'; level: string; message: string };

export class ReplyzeConfigError extends Error {
  constructor(message: string) {
    super(`[Replyze] ${message}`);
    this.name = 'ReplyzeConfigError';
  }
}

const TOKEN = /^[A-Za-z0-9_-]{4,128}$/;
const LANGUAGE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$/;
/** Plain http only for a backend on the developer's own machine (10.0.2.2 is the Android emulator's host). */
const DEV_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];

/**
 * scheme://host[:port] of an absolute http(s) URL, without the URL class:
 * React Native's own URL is incomplete on many versions.
 */
export function parseOrigin(value: string): { scheme: string; host: string; origin: string } | null {
  const m = /^(https?):\/\/([^/?#\s@"'<>\\`]+)(?:[/?#][^\s"'<>\\`]*)?$/i.exec(value.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  const host = authority.replace(/:\d+$/, '');
  if (!host || /[^a-z0-9.\-[\]:]/.test(host)) return null;
  return { scheme, host, origin: `${scheme}://${authority}` };
}

function checkUrl(name: string, value: string): string {
  const url = parseOrigin(value);
  if (!url) {
    throw new ReplyzeConfigError(`${name} must be an absolute http(s) URL without credentials, got "${value}".`);
  }
  if (url.scheme !== 'https' && !DEV_HOSTS.includes(url.host)) {
    throw new ReplyzeConfigError(`${name} must use https (http only for localhost), got "${value}".`);
  }
  return value.trim();
}

const stripSlash = (url: string) => url.replace(/\/+$/, '');

/** Checks the options and fills in the defaults; throws ReplyzeConfigError on a bad value. */
export function resolveOptions(options: Partial<ReplyzeOptions> | null | undefined): ResolvedOptions {
  const o = options || {};
  const token = typeof o.widgetToken === 'string' ? o.widgetToken.trim() : '';
  if (!TOKEN.test(token)) {
    throw new ReplyzeConfigError('widgetToken is missing or invalid. Copy it from Settings → Integrations → Install widget ("wgt_...").');
  }
  const language = typeof o.language === 'string' && o.language.trim() ? o.language.trim() : null;
  if (language && !LANGUAGE.test(language)) {
    throw new ReplyzeConfigError(`language must be a language code like "de" or "pt-BR", got "${language}".`);
  }
  const title = typeof o.pageTitle === 'string' && o.pageTitle.trim() ? o.pageTitle.trim().slice(0, 120) : DEFAULT_PAGE_TITLE;

  return {
    widgetToken: token,
    baseUrl: checkUrl('baseUrl', o.baseUrl || DEFAULT_BASE_URL),
    apiUrl: stripSlash(checkUrl('apiUrl', o.apiUrl || DEFAULT_API_URL)),
    cdnUrl: stripSlash(checkUrl('cdnUrl', o.cdnUrl || DEFAULT_CDN_URL)),
    language,
    tracking: o.tracking !== false,
    showCloseButton: o.showCloseButton !== false,
    pageTitle: title,
  };
}

/** For text and double-quoted attributes (every attribute here is double-quoted). */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The chat page: widget.js in in-app mode, configured by data attributes so
 * there is no inline script and the page's content security policy allows
 * scripts from the widget's CDN only. Loaded into the WebView as HTML with
 * baseUrl as its address.
 */
export function buildChatHtml(o: ResolvedOptions): string {
  const cdnOrigin = parseOrigin(o.cdnUrl)?.origin ?? DEFAULT_CDN_URL;
  const dev = [o.apiUrl, o.cdnUrl].some((u) => u.startsWith('http:'));
  const csp = [
    "default-src 'none'",
    `script-src ${cdnOrigin}`,
    // The widget draws its look with <style> elements in its shadow root
    "style-src 'unsafe-inline'",
    `img-src https: data: blob:${dev ? ' http:' : ''}`,
    'media-src https: data: blob:',
    'font-src https: data:',
    // The API and its websocket (the host comes from the widget's config)
    `connect-src https: wss:${dev ? ' http: ws:' : ''}`,
    // Videos embedded in help articles
    'frame-src https:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const attrs: Array<[string, string]> = [
    ['src', `${o.cdnUrl}/widget.js`],
    ['data-token', o.widgetToken],
    ['data-embedded', 'app'],
    ['data-api-url', o.apiUrl],
  ];
  if (o.language) attrs.push(['data-language', o.language]);
  if (!o.tracking) attrs.push(['data-tracking', 'false']);
  if (!o.showCloseButton) attrs.push(['data-close-button', 'false']);
  const script = attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');

  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(o.language || 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`,
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    `<title>${escapeHtml(o.pageTitle)}</title>`,
    '<style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}@media (prefers-color-scheme:dark){html,body{background:#0f172a}}</style>',
    '</head>',
    '<body>',
    `<script ${script}></script>`,
    '</body>',
    '</html>',
  ].join('\n');
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * The JavaScript that hands one command to the widget. JSON is a JavaScript
 * expression; U+2028/2029 are escaped for older engines. Ends in true, as
 * react-native-webview's injectJavaScript wants.
 */
export function commandScript(command: HostCommand): string {
  const json = JSON.stringify(command).split(LINE_SEPARATOR).join('\\u2028').split(PARAGRAPH_SEPARATOR).join('\\u2029');
  return `(function(){try{window.ReplyzeApp&&window.ReplyzeApp.receive(${json});}catch(e){}})();true;`;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** One message from the widget, checked; null for anything else the page might post. */
export function parseEvent(raw: unknown): WidgetEvent | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as { replyze?: unknown; type?: unknown; data?: unknown };
  if (event.replyze !== PROTOCOL_VERSION || typeof event.type !== 'string') return null;
  const data = (event.data && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;

  switch (event.type) {
    case 'ready':
      return { type: 'ready', version: typeof data.version === 'number' ? data.version : PROTOCOL_VERSION };
    case 'close':
      return { type: 'close' };
    case 'unread': {
      const count = typeof data.count === 'number' && Number.isFinite(data.count) ? Math.max(0, Math.floor(data.count)) : 0;
      return { type: 'unread', count };
    }
    case 'message':
      return {
        type: 'message',
        message: {
          id: str(data.id) ?? '',
          text: str(data.text) ?? '',
          sender: data.sender === 'agent' ? 'agent' : 'bot',
          senderName: str(data.senderName),
          createdAt: str(data.createdAt),
          type: str(data.type) ?? 'text',
        },
      };
    case 'identified':
      return { type: 'identified', verified: data.verified === true };
    case 'openUrl': {
      const url = str(data.url);
      return url && isExternalUrl(url) ? { type: 'openUrl', url } : null;
    }
    case 'error':
      return { type: 'error', error: { code: str(data.code) ?? 'unknown', message: str(data.message) ?? '' } };
    case 'log':
      return { type: 'log', level: str(data.level) ?? 'info', message: str(data.message) ?? '' };
    default:
      return null;
  }
}

/** Links the app opens itself: web pages, email, phone and SMS; never javascript:, file: or app schemes. */
export function isExternalUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:|tel:|sms:)/i.test(url.trim());
}

/**
 * Whether the WebView may load this URL itself: only the chat page (its
 * first load, at baseUrl) and blank or data pages. Anything else would take
 * the WebView away from the chat; the app opens links outside instead.
 */
export function isChatPage(url: string, baseUrl: string): boolean {
  if (!url || url === 'about:blank' || url.startsWith('about:srcdoc') || url.startsWith('data:')) return true;
  const strip = (u: string) => u.split('#')[0].replace(/\/+$/, '');
  return strip(url) === strip(baseUrl);
}

/** setInsets from React Native layout values, rounded and never negative. */
export function insetsCommand(insets: Partial<Insets> | null | undefined): HostCommand {
  const args: Partial<Insets> = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const v = insets?.[side];
    if (typeof v === 'number' && Number.isFinite(v)) args[side] = Math.max(0, Math.round(v));
  }
  return { cmd: 'setInsets', args };
}

/** The identify command from the SDK's camelCase user. */
export function identifyCommand(user: ReplyzeUser): HostCommand | null {
  const args: { email?: string; name?: string; user_id?: string | number; user_hash?: string } = {};
  if (typeof user?.email === 'string' && user.email.trim()) args.email = user.email.trim();
  if (typeof user?.name === 'string' && user.name.trim()) args.name = user.name.trim();
  if ((typeof user?.userId === 'string' && user.userId.trim()) || typeof user?.userId === 'number') {
    args.user_id = typeof user.userId === 'string' ? user.userId.trim() : user.userId;
  }
  if (typeof user?.userHash === 'string' && user.userHash.trim()) args.user_hash = user.userHash.trim();
  if (!args.email && !args.name && args.user_id === undefined) return null;
  return { cmd: 'identify', args };
}
