// Vercel-only wrapper. The real source is api/serverless-source.ts, bundled during
// vercel-build so Vercel runtime does not need to resolve monorepo-local packages.
import serverlessBundle from "../dist/serverless-bundle.cjs";

export default serverlessBundle.default ?? serverlessBundle;
