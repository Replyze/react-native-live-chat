# Changelog

All notable changes to `@replyze/react-native` are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Fixed

- `Replyze.reset()` with no chat loaded: no chat view mounted, or its page still loading, reloading, or loaded again by "Try again" or after a crash. The sign-out used to reach only a chat page that was ready, so the WebView kept the previous user's conversation in its storage, and the next person who opened the chat without signing in saw it. The session now keeps the sign-out until a chat page has carried it out, and that page resets before anything else. A sign-out that a ready chat carried out is not repeated.
- A reset sent while the WebView threw is kept for its next load instead of being lost.

## [0.1.0] - Unreleased

The first version.

### Added

- `<ReplyzeHost />`: the full-screen chat that `Replyze.show()` opens. Mounted once at the root, it loads the chat hidden so replies count as unread; Android's back button closes it.
- `<ReplyzeChat />`: the chat as one of your own screens, with `visible`, `insets`, `renderError` and a `reload()` ref.
- The `Replyze` API: `configure`, `show`, `hide`, `isVisible`, `identify` (with identity verification), `setData`, `pushEvent`, `setLanguage`, `openArticle`, `sendMessage`, `reset`, `getUnreadCount`, `onUnreadCountChange`, `onMessage`, `onError` and `onIdentified`.
- The chat runs the Replyze widget (`https://cdn.replyze.chat/widget.js`) in its in-app mode inside `react-native-webview`, on a page with a content security policy that allows scripts from the widget's CDN only. Links open outside the app. Calls made before the chat loads wait for it; who the user is, their data and the language are sent again when the WebView reloads.
- Works with Expo Go, Expo dev builds and bare React Native: no native code of its own. Type-checked against React 17 with React Native 0.68 and against React 19.3 with React Native 0.88; the component tests run on React 18 with React Native 0.76 and on React 19.3 with React Native 0.88; the Expo SDK 58 example bundles for Android and iOS.

[0.1.1]: https://github.com/Replyze/react-native-live-chat/releases/tag/v0.1.1
[0.1.0]: https://github.com/Replyze/react-native-live-chat/releases/tag/v0.1.0
