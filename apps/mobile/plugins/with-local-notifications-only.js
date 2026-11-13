const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * OIO uses expo-notifications for local 回忆提醒 only. Its config plugin is
 * auto-applied and adds the iOS push entitlement (aps-environment), which the
 * App Store provisioning profile does not carry, so archiving fails. Local
 * notifications do not need it: drop the key.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (iosConfig) => {
    delete iosConfig.modResults["aps-environment"];
    return iosConfig;
  });
};
