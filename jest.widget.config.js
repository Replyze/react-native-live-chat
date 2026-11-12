/**
 * The SDK against the real widget: the widget bundle (REPLYZE_WIDGET_JS, or
 * the live one from cdn.replyze.chat) runs in jsdom, with this package's
 * session on the app side of the bridge. Only the Replyze API is faked.
 */
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.widget.json' }] },
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.widget.test.ts'],
  globalSetup: '<rootDir>/__tests__/support/fetchWidget.js',
  testTimeout: 30000,
};
