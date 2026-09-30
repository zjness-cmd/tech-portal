// Shared Google Maps distance helpers — used by Dashboard.jsx (mileage
// tracking) and QuoteGenerator.jsx (travel fee calculation). Pulled out to
// its own module so both can import the same logic without creating a
// circular import between the two (Dashboard renders QuoteGenerator as a
// menu item, so QuoteGenerator can't import back from Dashboard).
const MAPS_API_KEY = import.meta.env.VITE_MAPS_API_KEY;

let mapsApiLoaded = false;
export function loadMapsApi() {
  if (mapsApiLoaded || window.google?.maps) { mapsApiLoaded = true; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + MAPS_API_KEY + "&libraries=geometry";
    script.async = true;
    script.onload = () => { mapsApiLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Straight-line (haversine) distance in miles — used as a fast fallback
// when the Distance Matrix API is unavailable/fails.
export function calcMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export async function getDrivingMiles(fromLat, fromLng, toLat, toLng) {
  const straightLine = Math.round(calcMiles(fromLat, fromLng, toLat, toLng) * 10) / 10;
  try {
    await loadMapsApi();
    if (!window.google?.maps?.DistanceMatrixService) return straightLine;
    return await new Promise((resolve) => {
      const service = new window.google.maps.DistanceMatrixService();
      service.getDistanceMatrix({
        origins: [new window.google.maps.LatLng(fromLat, fromLng)],
        destinations: [new window.google.maps.LatLng(toLat, toLng)],
        travelMode: window.google.maps.TravelMode.DRIVING,
        unitSystem: window.google.maps.UnitSystem.IMPERIAL,
      }, (res, status) => {
        if (status === "OK" && res.rows[0].elements[0].status === "OK") {
          const meters = res.rows[0].elements[0].distance.value;
          resolve(Math.round((meters / 1609.344) * 10) / 10);
        } else { resolve(straightLine); }
      });
    });
  } catch (e) { return straightLine; }
}
