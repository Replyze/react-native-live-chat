# Replyze React Native example

An Expo app with a Support button (with the unread count), a help article, sign-in and sign-out, and the chat as one of the app's screens.

```sh
cd example
npm install
npx expo start
```

Put your widget token (Replyze: Settings → Integrations → Install widget) in `App.tsx` first, and a `baseUrl` on one of the widget's allowed domains if it has a list. Expo Go is enough: the SDK has no native code of its own, only `react-native-webview`.
