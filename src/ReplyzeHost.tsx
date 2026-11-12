import { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { Replyze } from './Replyze';
import { ReplyzeChat, type ReplyzeChatProps } from './ReplyzeChat';

export interface ReplyzeHostProps extends Omit<ReplyzeChatProps, 'visible' | 'style'> {
  /**
   * Load the chat when the app starts (hidden), so replies that arrive
   * before the visitor opens it count as unread. Default true; false loads
   * it on the first Replyze.show().
   */
  preload?: boolean;
}

/**
 * The full-screen chat that Replyze.show() opens. Mount it once, as the last
 * child of your app's root view (after the navigation container), so it
 * covers everything. While hidden it stays loaded: unread replies are
 * counted (Replyze.onUnreadCountChange). Android's back button closes it.
 */
export function ReplyzeHost({ preload = true, onClose, ...chatProps }: ReplyzeHostProps) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(preload);
  const [configured, setConfigured] = useState(() => Replyze.getOptions() !== null || !!chatProps.widgetToken);

  useEffect(() => Replyze.subscribeOptions(() => setConfigured(Replyze.getOptions() !== null)), []);

  useEffect(() => {
    let shown = false;
    return Replyze.registerHost({
      show: () => {
        shown = true;
        setMounted(true);
        setVisible(true);
      },
      hide: () => {
        shown = false;
        setVisible(false);
      },
      isVisible: () => shown,
    });
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Replyze.hide();
      return true;
    });
    return () => subscription.remove();
  }, [visible]);

  const handleClose = useMemo(
    () => () => {
      Replyze.hide();
      onClose?.();
    },
    [onClose],
  );

  if (!mounted || (!configured && !chatProps.widgetToken)) return null;

  return (
    <View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.layer, visible ? null : styles.hidden]}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      <ReplyzeChat {...chatProps} visible={visible} onClose={handleClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 10000, elevation: 10000 },
  // Kept alive (not unmounted) so the chat goes on counting unread replies.
  hidden: { opacity: 0, transform: [{ translateY: 100000 }] },
});
