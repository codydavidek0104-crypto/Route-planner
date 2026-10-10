// Embedded styling keeps the existing Google Maps setup and native controls.
// These colors apply to the roadmap; satellite imagery remains photographic.
const D7_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#070b0d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#c4c9cc" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#070b0d" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#0c1114" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#080f0d" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#171e23" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#25313a" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#34424d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#93a0a8" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#070b0d" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#09151c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#698491" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0d1b16" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#819b8e" }] },
  { featureType: "poi.business", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] }
];

const D7_ROUTE_STYLE = {
  strokeColor: "#ed2944",
  strokeWeight: 5,
  strokeOpacity: 0.96
};

// Call only after the route and optimized order have been validated. On success,
// the caller owns these markers and must remove them when clearing route results.
// A null result leaves the DirectionsRenderer's normal markers as the fallback.
function renderRouteMarkers(map, result) {
  const markers = [];
  try {
    const maps = typeof google !== "undefined" && google.maps;
    if (!map || !maps || typeof maps.Marker !== "function" ||
        typeof maps.Point !== "function") return null;
    const legs = result && result.routes && result.routes[0] && result.routes[0].legs;
    if (!Array.isArray(legs) || !legs.length) return null;

    // Accept the real API's LatLng instances as well as LatLngLiteral fixtures.
    // Missing or invalid coordinates never become invented marker positions.
    const coordinates = location => {
      if (!location || typeof location !== "object") return null;
      const lat = typeof location.lat === "function" ? location.lat() : location.lat;
      const lng = typeof location.lng === "function" ? location.lng() : location.lng;
      return Number.isFinite(lat) && Number.isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
    };
    const locations = legs.map(leg => leg && {
      start: coordinates(leg.start_location), end: coordinates(leg.end_location)
    });
    if (locations.some(leg => !leg || !leg.start || !leg.end)) return null;
    const points = [locations[0].start, ...locations.map(leg => leg.end)];

    const icon = (content, width, height, anchorX, anchorY) => ({
      url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`
      ),
      anchor: new maps.Point(anchorX, anchorY)
    });
    const endpointIcon = icon(
      '<circle cx="16" cy="16" r="14" fill="#151a1c" stroke="#ed2944" stroke-width="2"/>' +
      '<path d="M16 24C14 21 10 17 10 13A6 6 0 0 1 22 13C22 17 18 21 16 24Z" fill="#f3f2ef"/>' +
      '<circle cx="16" cy="13" r="2.5" fill="#151a1c"/>',
      32, 32, 16, 16
    );

    points.forEach((position, index) => {
      const finish = index === points.length - 1;
      const title = index === 0 ? "Start" : finish ? "Finish" : `Stop ${index}`;
      const markerIcon = index === 0 || finish ? endpointIcon : icon(
        '<circle cx="16" cy="16" r="13" fill="#db1236" stroke="#f3f2ef" stroke-width="1.5"/>' +
        `<text x="16" y="21" text-anchor="middle" font-family="Arial,sans-serif" font-size="${index < 10 ? 15 : 13}" font-weight="600" fill="#f3f2ef">${index}</text>`,
        32, 32, 16, 16
      );
      markers.push(new maps.Marker({
        map, position, title, icon: markerIcon,
        optimized: false, draggable: false, zIndex: index === 0 || finish ? 1100 : 1000
      }));
    });
    return markers;
  } catch {
    // If a capability fails midway, roll back every successfully created marker.
    for (const marker of markers) {
      try { marker.setMap(null); } catch { /* Keep the renderer fallback available. */ }
    }
    return null;
  }
}
