const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      ...(projectId ? { projectId } : {}),
    },
  },
});