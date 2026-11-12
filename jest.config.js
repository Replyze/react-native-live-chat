/**
 * npm test: the bridge logic (plain TypeScript) and the components (React
 * Native's Jest preset, with the WebView mocked). The run against the real
 * widget is jest.widget.config.js (npm run test:widget).
 */
module.exports = {
  projects: [
    {
      displayName: 'bridge',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/__tests__'],
      testMatch: ['**/*.test.ts'],
      testPathIgnorePatterns: ['\\.widget\\.test\\.ts$'],
    },
    {
      displayName: 'components',
      preset: 'react-native',
      roots: ['<rootDir>/__tests__'],
      testMatch: ['**/*.test.tsx'],
    },
  ],
};
