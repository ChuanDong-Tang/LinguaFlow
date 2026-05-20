const { withAndroidManifest, withInfoPlist } = require("@expo/config-plugins");

const WECHAT_PACKAGE = "com.tencent.mm";

module.exports = function withWechatPay(config) {
  return withInfoPlist(
    withAndroidManifest(config, (androidConfig) => {
      const manifest = androidConfig.modResults.manifest;
      manifest.queries = manifest.queries || [];

      const hasWechatQuery = manifest.queries.some((query) =>
        query.package?.some((item) => item.$?.["android:name"] === WECHAT_PACKAGE)
      );
      if (!hasWechatQuery) {
        manifest.queries.push({ package: [{ $: { "android:name": WECHAT_PACKAGE } }] });
      }

      return androidConfig;
    }),
    (iosConfig) => {
      const configuredAppId = iosConfig.extra?.wechatAppId;
      const appId =
        configuredAppId && !String(configuredAppId).includes("${")
          ? configuredAppId
          : process.env.EXPO_PUBLIC_WECHAT_APP_ID;
      const plist = iosConfig.modResults;
      plist.LSApplicationQueriesSchemes = Array.from(
        new Set([...(plist.LSApplicationQueriesSchemes || []), "wechat", "weixin", "weixinULAPI"])
      );

      if (appId) {
        const urlTypes = plist.CFBundleURLTypes || [];
        const hasWechatScheme = urlTypes.some((item) =>
          item.CFBundleURLSchemes?.includes(appId)
        );
        if (!hasWechatScheme) {
          urlTypes.push({
            CFBundleURLName: "wechat",
            CFBundleURLSchemes: [appId],
          });
        }
        plist.CFBundleURLTypes = urlTypes;
      }

      return iosConfig;
    }
  );
};
