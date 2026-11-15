'use strict';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Jarak dua titik koordinat (meter) dengan rumus Haversine. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Cari lokasi terdekat dari daftar site.
 * @returns {{site: object, distance: number} | null}
 */
function nearestSite(lat, lng, sites) {
  let best = null;
  for (const site of sites) {
    const d = distanceMeters(lat, lng, site.latitude, site.longitude);
    if (!best || d < best.distance) best = { site, distance: d };
  }
  return best;
}

module.exports = { distanceMeters, nearestSite };
