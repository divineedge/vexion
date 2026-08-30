const appJson = require("./app.json");

const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      eas: {
        ...appJson.expo.extra?.eas,
        ...(projectId ? { projectId } : {}),
      },
    },
  },
};