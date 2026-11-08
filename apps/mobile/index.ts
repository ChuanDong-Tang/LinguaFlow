import React, { useEffect, useState } from "react";
import { registerRootComponent } from "expo";
import * as SplashScreen from "expo-splash-screen";
import { loadAppearance } from "./src/appearance/preference";

// The palette is chosen before App (and theme.ts) is evaluated, because styles
// are created at module load. See src/appearance/state.ts.
// Keep the native splash up while the preference loads; App hides it when ready.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Root() {
  const [App, setApp] = useState<React.ComponentType | null>(null);
  useEffect(() => {
    void loadAppearance().then(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const loaded = require("./App").default as React.ComponentType;
      setApp(() => loaded);
    });
  }, []);
  return App ? React.createElement(App) : null;
}

registerRootComponent(Root);
