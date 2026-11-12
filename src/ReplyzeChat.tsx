import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { Replyze } from './Replyze';
import {
  buildChatHtml,
  isChatPage,
  isExternalUrl,
  resolveOptions,
  type Insets,
  type ReplyzeError,
  type ReplyzeMessage,
  type ReplyzeOptions,
  type ResolvedOptions,
} from './protocol';
import type { Connection } from './session';

export interface ReplyzeChatProps extends Partial<ReplyzeOptions> {
  /**
   * Whether the chat is on screen. While false the chat keeps running, and
   * replies count as unread. Default true.
   */
  visible?: boolean;
  /** The visitor tapped close in the chat (e.g. navigation.goBack()). */
  onClose?: () => void;
  onReady?: () => void;
  onUnreadCountChange?: (count: number) => void;
  onMessage?: (message: ReplyzeMessage) => void;
  onError?: (error: ReplyzeError) => void;
  /** A link in the chat; default Linking.openURL (browser, mail, phone). */
  onOpenUrl?: (url: string) => void;
  /**
   * Safe-area insets, e.g. useSafeAreaInsets() from react-native-safe-area-context.
   * Without them the page's own env(safe-area-inset-*) is used, which iOS
   * fills in; pass them on edge-to-edge Android.
   */
  insets?: Partial<Insets>;
  style?: StyleProp<ViewStyle>;
  /** Shown when the chat can't load (no connection, wrong token). */
  renderError?: (retry: () => void, error: ReplyzeError) => React.ReactNode;
}

export interface ReplyzeChatHandle {
  /** Loads the chat page again (e.g. after the connection came back). */
  reload(): void;
}

function useGlobalOptions(): ReplyzeOptions | null {
  const [options, setOptions] = useState(() => Replyze.getOptions());
  useEffect(() => Replyze.subscribeOptions(() => setOptions(Replyze.getOptions())), []);
  return options;
}

/**
 * The Replyze chat in a view of its own: a whole screen of your app, a tab,
 * or (through <ReplyzeHost />) the full-screen chat Replyze.show() opens.
 * Uses Replyze.configure()'s options; props override them.
 */
export const ReplyzeChat = forwardRef<ReplyzeChatHandle, ReplyzeChatProps>(function ReplyzeChat(props, ref) {
  const {
    visible = true,
    insets,
    style,
    renderError,
    onClose,
    onReady,
    onUnreadCountChange,
    onMessage,
    onError,
    onOpenUrl,
    widgetToken,
    baseUrl,
    apiUrl,
    cdnUrl,
    language,
    tracking,
    showCloseButton,
    pageTitle,
  } = props;
  const global = useGlobalOptions();

  const resolved = useMemo((): { options: ResolvedOptions | null; error: ReplyzeError | null } => {
    try {
      const own = { widgetToken, baseUrl, apiUrl, cdnUrl, language, tracking, showCloseButton, pageTitle };
      const merged: Partial<ReplyzeOptions> = { ...(global || {}) };
      for (const [key, value] of Object.entries(own)) {
        if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
      }
      return { options: resolveOptions(merged), error: null };
    } catch (e) {
      return { options: null, error: { code: 'invalid_options', message: e instanceof Error ? e.message : String(e) } };
    }
  }, [global, widgetToken, baseUrl, apiUrl, cdnUrl, language, tracking, showCloseButton, pageTitle]);

  const options = resolved.options;
  const html = useMemo(() => (options ? buildChatHtml(options) : ''), [options]);

  const webRef = useRef<WebView>(null);
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<ReplyzeError | null>(null);

  // The latest callbacks, for the connection made once.
  const latest = useRef({ onClose, onReady, onError, onOpenUrl, onUnreadCountChange, onMessage });
  latest.current = { onClose, onReady, onError, onOpenUrl, onUnreadCountChange, onMessage };

  const openUrl = useCallback((url: string) => {
    if (!isExternalUrl(url)) return;
    if (latest.current.onOpenUrl) latest.current.onOpenUrl(url);
    else Linking.openURL(url).catch(() => undefined);
  }, []);

  const connectionRef = useRef<Connection | null>(null);
  useEffect(() => {
    const connection = Replyze.session.connect((script) => webRef.current?.injectJavaScript(script), {
      onReady: () => {
        setFailure(null);
        latest.current.onReady?.();
      },
      onClose: () => latest.current.onClose?.(),
      onOpenUrl: openUrl,
      onError: (error) => {
        if (error.code === 'load_timeout') setFailure(error);
        latest.current.onError?.(error);
      },
    });
    connectionRef.current = connection;
    // The session's events, for this view's props.
    const offUnread = Replyze.session.onUnreadCountChange((count) => latest.current.onUnreadCountChange?.(count));
    const offMessage = Replyze.session.onMessage((message) => latest.current.onMessage?.(message));
    return () => {
      offUnread();
      offMessage();
      connection.disconnect();
      connectionRef.current = null;
    };
  }, [openUrl]);

  useEffect(() => {
    connectionRef.current?.setVisible(visible);
  }, [visible]);

  const { top, right, bottom, left } = insets || {};
  useEffect(() => {
    const given = [top, right, bottom, left].some((v) => typeof v === 'number');
    connectionRef.current?.setInsets(given ? { top, right, bottom, left } : null);
  }, [top, right, bottom, left]);

  useEffect(() => {
    if (resolved.error) {
      console.error(resolved.error.message);
      latest.current.onError?.(resolved.error);
    }
  }, [resolved.error]);

  const reload = useCallback(() => {
    // A fresh WebView, never WebView.reload(): that would load baseUrl itself.
    connectionRef.current?.reloaded();
    setFailure(null);
    setGeneration((g) => g + 1);
  }, []);
  useImperativeHandle(ref, () => ({ reload }), [reload]);

  // New options mean a new page.
  const firstHtml = useRef(true);
  useEffect(() => {
    if (firstHtml.current) {
      firstHtml.current = false;
      return;
    }
    connectionRef.current?.reloaded();
  }, [html]);

  const onMessageEvent = useCallback((event: WebViewMessageEvent) => {
    connectionRef.current?.receive(event.nativeEvent.data);
  }, []);

  const onShouldStartLoad = useCallback(
    (request: { url: string; isTopFrame?: boolean }) => {
      if (!options) return false;
      if (isChatPage(request.url, options.baseUrl) || request.isTopFrame === false) return true;
      openUrl(request.url);
      return false;
    },
    [options, openUrl],
  );

  if (!options) {
    return <View style={[styles.fill, style]} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      // iOS: the WebView keeps the composer above the keyboard itself.
      // Android: resized with the window, or padded on edge-to-edge apps.
      behavior={Platform.OS === 'android' ? 'height' : undefined}
      enabled={Platform.OS === 'android'}
    >
      <WebView
        key={generation}
        ref={webRef}
        source={{ html, baseUrl: options.baseUrl }}
        originWhitelist={['*']}
        onMessage={onMessageEvent}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onContentProcessDidTerminate={reload}
        onRenderProcessGone={reload}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback
        allowsBackForwardNavigationGestures={false}
        bounces={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        keyboardDisplayRequiresUserAction={false}
        textZoom={100}
        style={styles.web}
      />
      {failure ? (
        <View style={styles.cover}>
          {renderError ? renderError(reload, failure) : <DefaultError retry={reload} />}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
});

function DefaultError({ retry }: { retry: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>The chat couldn't load.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setBusy(true);
          retry();
        }}
        style={styles.retry}
      >
        {busy ? <ActivityIndicator /> : <Text style={styles.retryText}>Try again</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  error: { alignItems: 'center', padding: 24 },
  errorText: { fontSize: 16, color: '#1f2937', marginBottom: 16, textAlign: 'center' },
  retry: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#eef0f3', minWidth: 120, alignItems: 'center' },
  retryText: { fontSize: 15, fontWeight: '600', color: '#111827' },
});
