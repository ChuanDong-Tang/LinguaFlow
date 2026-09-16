const { withPodfile } = require("@expo/config-plugins");

const MINIMUM_IOS_VERSION = "15.1";
const MARKER = "# OIO: normalize CocoaPods deployment targets";

const POD_TARGET_OVERRIDE = `
    ${MARKER}
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |build_configuration|
        current_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current_target.nil? || Gem::Version.new(current_target) < Gem::Version.new('${MINIMUM_IOS_VERSION}')
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MINIMUM_IOS_VERSION}'
        end
      end
    end
`;

module.exports = function withIosPodDeploymentTarget(config) {
  return withPodfile(config, (iosConfig) => {
    const podfile = iosConfig.modResults.contents;
    if (podfile.includes(MARKER)) return iosConfig;

    const postInstallEnd = /(    react_native_post_install\([\s\S]*?\n    \)\n)(  end\nend\s*)$/;
    if (!postInstallEnd.test(podfile)) {
      throw new Error("Unable to locate React Native post_install block in iOS Podfile");
    }

    iosConfig.modResults.contents = podfile.replace(
      postInstallEnd,
      `$1${POD_TARGET_OVERRIDE}$2`
    );
    return iosConfig;
  });
};
