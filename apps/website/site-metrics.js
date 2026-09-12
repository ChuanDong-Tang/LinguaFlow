const beaconPath = "/assets/shared/brand/favicon.svg";

document.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;

  let metric;
  if (link.matches(".official-store-link")) metric = "download_ios";
  if (link.matches(".android-download-button")) metric = "download_android";
  if (!metric) return;

  const beacon = new URL(beaconPath, location.origin);
  beacon.searchParams.set("oio_event", metric);
  beacon.searchParams.set("page", location.pathname);
  fetch(beacon, { cache: "no-store", credentials: "omit", keepalive: true }).catch(() => {});
});
