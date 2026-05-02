const { expo: staticConfig } = require('./app.json');

const _apiUrl = process.env.EXPO_PUBLIC_API_URL;
const RPID = process.env.RPID ?? (_apiUrl ? new URL(_apiUrl).hostname : undefined);
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'com.yourteam.passkey-poc';

module.exports = {
  ...staticConfig,
  ios: {
    ...staticConfig.ios,
    bundleIdentifier: IOS_BUNDLE_ID,
    // webcredentials: パスキー登録・認証に使用
    // applinks: Universal Links（AC-3 クロスデバイス QR 後の intent 受け取りに使用）
    associatedDomains: RPID
      ? [`webcredentials:${RPID}`, `applinks:${RPID}`]
      : [],
  },
};
