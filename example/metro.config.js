// Lets Metro use the SDK from the folder above (file:..) with this app's
// own react, react-native and react-native-webview.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const sdk = path.resolve(__dirname, '..');

config.watchFolders = [sdk];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.extraNodeModules = {
  '@replyze/react-native': sdk,
};
config.resolver.blockList = [new RegExp(`${sdk.replace(/[\\/]/g, '[\\\\/]')}[\\\\/]node_modules[\\\\/].*`)];

module.exports = config;
