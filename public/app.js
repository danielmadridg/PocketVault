// Bridge from v1. Firebase served the old index.html with max-age=3600, so for up to
// an hour after the v2 deploy a browser may still run the cached v1 page, which loads
// this file. Reload once to pick up the new app. Safe to delete from 2026-11 on.
try {
  if (!sessionStorage.getItem('pv:v2-bridge')) {
    sessionStorage.setItem('pv:v2-bridge', '1');
    location.reload();
  }
} catch (_) {
  location.reload();
}
