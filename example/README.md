# Replyze React Native example

An Expo app (Expo SDK 58) with a Support button that shows the unread count, a help article, sign-in and sign-out, and the chat as one of the app's screens. It uses the package from the folder above.

```sh
npm ci            # in the repository root: builds lib/
cd example
npm install
npx expo start
```

Put your widget token (Replyze: Settings → Integrations → Install widget) in `App.tsx` first, and a `baseUrl` on one of the widget's allowed domains if it has a list. Expo Go is enough: the SDK has no native code of its own, only `react-native-webview`.

`npm run typecheck` checks `App.tsx` against the built package. CI also installs the packed package here and bundles the app for Android and iOS with `npx expo export`.
