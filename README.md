<p align="center">
  <a href="https://replyze.chat/?utm_source=github&utm_medium=react-native-live-chat">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Replyze/.github/main/assets/logo-on-dark.png">
      <img src="https://raw.githubusercontent.com/Replyze/.github/main/assets/logo-on-light.png" alt="Replyze" height="48">
    </picture>
  </a>
</p>

# Live chat and AI support for React Native and Expo apps

`@replyze/react-native` puts the [Replyze](https://replyze.chat/?utm_source=github&utm_medium=react-native-live-chat) live chat and AI assistant inside your React Native or Expo app. It is the same chat as the Replyze widget on your website, running in a WebView: AI answers, your team's replies, help articles, the visitor's language, file attachments and identity verification all work, and new widget features reach your app without an app update. The package has no native code of its own, so it works in Expo Go, Expo dev builds and bare React Native.

**[Create a free account](https://client.replyze.chat/register?utm_source=github&utm_medium=react-native-live-chat&utm_content=cta-top)** · [Live demo](https://replyze.chat/?utm_source=github&utm_medium=react-native-live-chat&utm_content=live-demo) · [Docs](https://github.com/Replyze/replyze)

The live demo is replyze.chat itself: the chat bubble in the bottom-right corner is the widget this package runs in your app.

## Quickstart

1. **Get your widget token.** [Create a free account](https://client.replyze.chat/register?utm_source=github&utm_medium=react-native-live-chat&utm_content=quickstart), then copy the token (`wgt_...`) from **Settings → Integrations → Install widget**.
2. **Install the package** from GitHub, with `react-native-webview`:
   ```sh
   # Expo
   npx expo install react-native-webview
   npm install github:Replyze/react-native-live-chat

   # bare React Native
   npm install github:Replyze/react-native-live-chat react-native-webview
   cd ios && pod install
   ```
3. **Configure it and mount the chat** once, in your root component. `Replyze.show()` opens it from any button:
   ```tsx
   import { Button, View } from 'react-native';
   import { Replyze, ReplyzeHost } from '@replyze/react-native';

   Replyze.configure({ widgetToken: 'wgt_YOUR_TOKEN' });

   export default function App() {
     return (
       <View style={{ flex: 1, justifyContent: 'center' }}>
         <Button title="Chat with us" onPress={() => Replyze.show()} />
         <ReplyzeHost />
       </View>
     );
   }
   ```

Tap the button and the chat opens full screen. If your widget has an allowed-domains list, add `baseUrl` (see [Allowed domains](#allowed-domains)).

## Contents

[Install](#install) · [Open the chat](#open-the-chat) · [The chat as one of your screens](#the-chat-as-one-of-your-screens) · [Allowed domains](#allowed-domains) · [Who the user is](#who-the-user-is) · [API](#api) · [Options](#options) · [Component props](#component-props) · [Safe areas and the keyboard](#safe-areas-and-the-keyboard) · [Platform notes](#platform-notes) · [How it works](#how-it-works) · [Example app](#example-app) · [Development](#development)

## Install

`@replyze/react-native` is not on the npm registry yet. Install it from GitHub, as in the Quickstart:

```sh
npm install github:Replyze/react-native-live-chat
```

You import it as `@replyze/react-native`. npm builds the package while it installs (its `prepare` script runs the TypeScript compiler), so the install needs git and takes longer than a package from the registry. Pin a commit or tag with `github:Replyze/react-native-live-chat#<ref>`.

After the first npm release (not yet), the registry install will be:

```sh
npx expo install @replyze/react-native react-native-webview   # Expo
npm install @replyze/react-native react-native-webview        # bare React Native
```

Requirements: React 17 or newer, React Native 0.68 or newer and `react-native-webview` 11 or newer (peer dependencies; the current Expo SDK pins a matching `react-native-webview` with `npx expo install`). You also need a Replyze account ([sign up](https://client.replyze.chat/register?utm_source=github&utm_medium=react-native-live-chat&utm_content=install)).

## Open the chat

`<ReplyzeHost />` draws the full-screen chat that `Replyze.show()` opens. Mount it once, as the last child of your root view (after your navigation container), so it covers every screen. It loads the chat hidden when the app starts, so replies that arrive while the chat is closed count as unread; `preload={false}` loads it on the first `show()` instead. Android's back button and the close button in the chat close it.

A Help button with the unread count:

```tsx
import { useEffect, useState } from 'react';
import { Button } from 'react-native';
import { Replyze } from '@replyze/react-native';

export function HelpButton() {
  const [unread, setUnread] = useState(Replyze.getUnreadCount());
  useEffect(() => Replyze.onUnreadCountChange(setUnread), []);
  return <Button title={unread > 0 ? `Help (${unread})` : 'Help'} onPress={() => Replyze.show()} />;
}
```

## The chat as one of your screens

```tsx
import { ReplyzeChat } from '@replyze/react-native';

function SupportScreen({ navigation }) {
  return <ReplyzeChat style={{ flex: 1 }} onClose={() => navigation.goBack()} />;
}
```

`showCloseButton={false}` hides the chat's own close buttons, for example in a tab. Every option of `Replyze.configure()` can also be a prop.

## Allowed domains

The Replyze API checks the widget's allowed-domains list (**Settings → Chat Widget**) against the page's address. In an app that address is `baseUrl`; nothing is loaded from it. When the list is empty, any `baseUrl` works and you can leave it out. When it has domains, set `baseUrl` to a URL on one of them:

```ts
Replyze.configure({
  widgetToken: 'wgt_YOUR_TOKEN',
  baseUrl: 'https://yourshop.com/app',
});
```

The inbox shows `baseUrl` as the page the visitor wrote from, with the title "In-app chat" (`pageTitle` changes it).

If the domain isn't allowed, the chat shows no conversation and, in development, the log says `[Replyze] Widget blocked: this domain (...) is not in the widget's allowed-domains list`.

## Who the user is

```ts
// After sign-in. With identity verification on (Settings → Chat Widget →
// Identity), userHash is the HMAC-SHA256 of the user id (or, without one,
// of the email in lower case), keyed with the identity secret, as hex.
// Compute it on YOUR server. Never ship the identity secret in the app.
Replyze.identify({ userId: user.id, email: user.email, name: user.name, userHash });

// On sign-out: the chat forgets the user and starts as a new visitor.
Replyze.reset();
```

A verified user is the same contact on every device and on your website, with their past conversations. `Replyze.onIdentified` reports `{ verified: true }` when the hash matched. A hash that doesn't match changes nothing; in development the log says `[Replyze] Failed to identify user`.

Server side, in Node.js:

```js
const crypto = require('crypto');
const userHash = crypto.createHmac('sha256', process.env.REPLYZE_IDENTITY_SECRET).update(String(user.id).trim()).digest('hex');
```

## API

| Call | What it does |
| --- | --- |
| `Replyze.configure(options)` | Once, before the chat is shown. Throws `ReplyzeConfigError` on a bad option. |
| `Replyze.show()` / `hide()` / `isVisible()` | Opens and closes the full-screen chat (needs `<ReplyzeHost />`). |
| `Replyze.identify({ email, name, userId, userHash })` | Who the user is. |
| `Replyze.setData({ plan: 'pro', seats: 3 })` | The user's custom data. Keys that match a contact field fill it; others are kept as extra data; `null` removes a key. Text, numbers and booleans only. |
| `Replyze.pushEvent('Upgraded', { plan: 'pro' })` | An event on the user's timeline in the inbox. |
| `Replyze.setLanguage('de')` | The chat's language, over the device's. |
| `Replyze.openArticle(12)` | Opens the chat on a help article (needs the widget's Home or Help tab). |
| `Replyze.sendMessage('...')` | Sends a message as the user. |
| `Replyze.reset()` | Sign-out. |
| `Replyze.onUnreadCountChange(cb)` / `getUnreadCount()` | Unread replies while the chat is closed. Returns an unsubscribe function. |
| `Replyze.onMessage(cb)` | Every reply from the AI or the team: `{ id, text, sender: 'bot' \| 'agent', senderName, createdAt, type }`. |
| `Replyze.onError(cb)` | `load_timeout` (the chat didn't load), `help_unavailable`, `invalid_options`. |
| `Replyze.onIdentified(cb)` | `{ verified }` after `identify()`. |

Calls made before the chat has loaded wait for it. Who the user is, their data and the language are sent again whenever the WebView reloads.

## Options

| Option | Default | |
| --- | --- | --- |
| `widgetToken` | (required) | Settings → Integrations → Install widget. |
| `baseUrl` | `https://cdn.replyze.chat/in-app` | The page's address; see [Allowed domains](#allowed-domains). |
| `language` | the device's, or the widget's setting | `"de"`, `"sr"`, `"pt-BR"`... |
| `tracking` | `true` | Visitor presence (Visitors page). |
| `showCloseButton` | `true` | |
| `pageTitle` | `"In-app chat"` | What the team sees as the page title. |
| `apiUrl`, `cdnUrl` | Replyze's | Only for a staging or local backend (plain http is allowed for localhost and 10.0.2.2). |

## Component props

`<ReplyzeChat />` and `<ReplyzeHost />` take the options above plus:

- `onClose`, `onReady`, `onMessage`, `onUnreadCountChange`, `onError`
- `onOpenUrl(url)`: links in the chat (default: `Linking.openURL`, so web pages open in the browser and `mailto:`/`tel:` links in their apps)
- `insets`: safe-area insets (see below)
- `renderError(retry, error)`: what to show when the chat can't load (default: a short message and "Try again")
- `<ReplyzeChat visible={false} />`: the chat keeps running off screen and replies count as unread.
- `ReplyzeChat` takes a ref with `reload()`.
- `<ReplyzeHost preload={false} />`: load the chat on the first `show()`.

## Safe areas and the keyboard

On iOS the chat page reads the safe areas itself. Android apps that draw edge to edge (the default when they target Android 15 or newer) should pass the insets, so the chat's header and composer stay clear of the system bars. With `react-native-safe-area-context` (React Navigation and Expo Router apps already have it; otherwise `npx expo install react-native-safe-area-context`):

```tsx
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function Root() {
  const insets = useSafeAreaInsets(); // needs <SafeAreaProvider> above
  return (
    <View style={{ flex: 1 }}>
      <YourNavigation />
      <ReplyzeHost insets={insets} />
    </View>
  );
}
```

The keyboard: on iOS the chat keeps its composer above the keyboard itself. On Android the chat is resized with the window, or padded by a keyboard-avoiding wrapper on edge-to-edge apps.

## Platform notes

- **iOS**: attachments use the system picker. If you offer camera uploads, add `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` to Info.plist (`ios.infoPlist` in Expo's app.json).
- **Android**: the file picker works through react-native-webview.
- The status bar strip above the chat takes your widget's brand colour; use a light status bar style while the chat is open if the colour is dark.
- The chat keeps running while hidden and while the app is in the foreground. In the background the operating system pauses it, so unread counts update when the app comes back. Notifications for replies while the app is closed are not part of this package yet; [docs/push-notifications.md](docs/push-notifications.md) shows how to send them from your server with a webhook.

## How it works

The package builds a small HTML page that loads `widget.js` from Replyze's CDN with `data-embedded="app"` and loads it into a WebView at `baseUrl`. The page has no inline script and a content security policy that allows scripts from the CDN only. The widget and the app talk over a small, versioned JSON bridge (`src/protocol.ts`); links never navigate the WebView, they go to the app.

## Example app

[`example/`](example/) is an Expo app with a Support button that shows the unread count, a help article, sign-in and sign-out, and the chat as one of the app's screens. See its [README](example/README.md).

## Development

```sh
npm ci
npm run typecheck
npm test            # the bridge logic and the components
npm run test:widget # the bridge against the real widget (downloads cdn.replyze.chat/widget.js)
npm run build       # lib/
```

`npm run test:widget` runs the widget bundle in jsdom with only the Replyze API faked. Set `REPLYZE_WIDGET_JS` to a local `widget.js` to test another build, or `REPLYZE_WIDGET_URL` to download one from elsewhere.

CI also type-checks `src/` against the oldest and the newest supported React, React Native and `react-native-webview` (`tsconfig.peers.json`), and installs the packed package into the Expo example to type-check and bundle it for Android and iOS. Releases: [RELEASING.md](RELEASING.md).

## Links

- [Replyze](https://replyze.chat/?utm_source=github&utm_medium=react-native-live-chat&utm_content=footer): AI customer support and live chat
- [Pricing](https://replyze.chat/pricing?utm_source=github&utm_medium=react-native-live-chat&utm_content=footer)
- [Flutter version](https://github.com/Replyze/flutter-live-chat)
- [Changelog](CHANGELOG.md)

## License

MIT
