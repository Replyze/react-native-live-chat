/**
 * A small app with the Replyze chat: a Support button with the unread
 * count, sign-in and sign-out, and the chat as one of the app's own screens.
 * Run it with Expo (see example/README.md).
 */
import { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Replyze, ReplyzeChat, ReplyzeHost } from '@replyze/react-native';

// Your widget's token (Settings → Integrations → Install widget) and,
// when the widget has an allowed-domains list, a URL on one of those domains.
Replyze.configure({
  widgetToken: 'wgt_your_widget_token',
  baseUrl: 'https://yourshop.example/app',
});

function SupportButton() {
  const [unread, setUnread] = useState(Replyze.getUnreadCount());
  useEffect(() => Replyze.onUnreadCountChange(setUnread), []);
  return (
    <Pressable style={styles.button} onPress={() => Replyze.show()} accessibilityRole="button">
      <Text style={styles.buttonText}>Support{unread > 0 ? ` (${unread})` : ''}</Text>
    </Pressable>
  );
}

function Home() {
  // Android apps draw edge to edge: the chat needs the safe-area insets.
  const insets = useSafeAreaInsets();
  const [signedIn, setSignedIn] = useState(false);
  const [inlineChat, setInlineChat] = useState(false);

  useEffect(() => Replyze.onMessage((message) => console.log('Reply from', message.senderName ?? message.sender, message.text)), []);

  const signIn = async () => {
    // userHash comes from YOUR server: HMAC-SHA256 of the user id, keyed
    // with the identity secret. Never put the identity secret in the app.
    const userHash = await fetch('https://yourshop.example/api/replyze-hash')
      .then((r) => r.text())
      .catch(() => undefined);
    Replyze.identify({ userId: 'user_1234', email: 'ana@example.com', name: 'Ana', userHash });
    Replyze.setData({ plan: 'pro', app_version: '3.2.0' });
    Replyze.pushEvent('Signed in');
    setSignedIn(true);
  };

  const signOut = () => {
    Replyze.reset();
    setSignedIn(false);
  };

  if (inlineChat) {
    // The chat as one of your screens (e.g. a tab or a stack screen)
    return <ReplyzeChat insets={insets} onClose={() => setInlineChat(false)} />;
  }

  return (
    <View style={styles.fill}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>My Shop</Text>
        <SupportButton />
        <Pressable style={styles.button} onPress={() => Replyze.openArticle(12)}>
          <Text style={styles.buttonText}>How do returns work?</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => setInlineChat(true)}>
          <Text style={styles.buttonText}>Chat as a screen</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={signedIn ? signOut : signIn}>
          <Text style={styles.buttonText}>{signedIn ? 'Sign out' : 'Sign in as Ana'}</Text>
        </Pressable>
      </SafeAreaView>
      {/* Once, last in the root view: the chat Replyze.show() opens */}
      <ReplyzeHost insets={insets} onError={(e) => console.warn(e.code, e.message)} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Home />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
  button: { backgroundColor: '#111827', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, minWidth: 220, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
