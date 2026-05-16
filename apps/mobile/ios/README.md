# iOS native project placeholder

This directory is reserved for the Expo-generated iOS native project.

On a machine with macOS/Xcode, generate the real project with:

```sh
npx expo prebuild --platform ios
```

On Windows, use EAS Build for the iOS artifact. This folder intentionally does
not contain `.xcodeproj`, CocoaPods, or native source files.

From `apps/mobile`:

```sh
npm run build:ios:preview
```

The preview profile is configured for internal device distribution, so it needs
Apple signing credentials in EAS. A local Mac is not required, but installing on
a physical iPhone still depends on Apple's signing/provisioning flow.
