export function hasActiveProAccess(access) {
  return Boolean(access?.entitlements?.some((item) => item?.active));
}
