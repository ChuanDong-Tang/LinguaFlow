# iOS native project placeholder

This directory is reserved for the Expo-generated iOS native project.

The app injects `LFSelectableMessageTextManager.m` through the Expo config
plugin at `plugins/withSelectableMessageTextIOS.js`. Android uses the matching
`plugins/withSelectableMessageTextAndroid.js` plugin. That keeps the native
selectable text bridge versioned even when generated native projects are not
checked in.

On a machine with macOS/Xcode, generate the real project with:

```sh
npx expo prebuild --platform ios
```

On Windows, use EAS Build for the iOS artifact. EAS runs prebuild on macOS and
will apply the config plugin during the remote build, so this folder
intentionally does not contain `.xcodeproj`, CocoaPods, or native source files.

From `apps/mobile`:

```sh
npm run build:ios:preview
```

The preview profile is configured for internal device distribution, so it needs
Apple signing credentials in EAS. A local Mac is not required, but installing on
a physical iPhone still depends on Apple's signing/provisioning flow.
