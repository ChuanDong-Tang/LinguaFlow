ALTER TABLE "entitlements"
  ADD COLUMN "imageLimit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "usedImages" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "entitlements"
  ADD CONSTRAINT "entitlements_image_quota_nonnegative_check"
  CHECK ("imageLimit" >= 0 AND "usedImages" >= 0);
