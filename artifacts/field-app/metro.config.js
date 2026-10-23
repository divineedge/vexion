const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shared workspace libraries also serve web apps on React 19.2. Always use
// the mobile app's SDK-compatible React, including its JSX runtime subpaths.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/^(react|react-dom)(\/|$)/.test(moduleName)) {
    return {
      type: 'sourceFile',
      filePath: require.resolve(moduleName, { paths: [__dirname] }),
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
