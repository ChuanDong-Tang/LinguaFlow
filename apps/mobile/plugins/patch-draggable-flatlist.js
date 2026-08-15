const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..", "node_modules", "react-native-draggable-flatlist");
const sourceFile = path.join(packageRoot, "src", "components", "NestableDraggableFlatList.tsx");

if (!fs.existsSync(sourceFile)) process.exit(0);

const original = fs.readFileSync(sourceFile, "utf8");
const patched = original
  .replace("import { findNodeHandle, LogBox } from \"react-native\";", "import { LogBox } from \"react-native\";")
  .replace(
    "const nodeHandle = findNodeHandle(scrollableRef.current);",
    "const nodeHandle = scrollableRef.current;",
  );

if (patched === original) {
  if (!original.includes("const nodeHandle = scrollableRef.current;")) {
    throw new Error("Unable to patch react-native-draggable-flatlist measureLayout compatibility");
  }
  process.exit(0);
}

fs.writeFileSync(sourceFile, patched);
