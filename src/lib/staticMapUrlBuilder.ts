import type { PlaceSelection } from '../types/mileage';

const STATIC_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api/staticmap';

const DARK_MODE_MAP_STYLES = [
  'element:geometry|color:0x1e293b',
  'element:labels.text.fill|color:0x94a3b8',
  'element:labels.text.stroke|color:0x0f172a',
  'feature:road|element:geometry|color:0x334155',
  'feature:road.highway|element:geometry|color:0x475569',
  'feature:water|element:geometry|color:0x0f172a',
  'feature:poi|visibility:off',
];

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) {
    sgnNum = ~sgnNum;
  }
  let encoded = '';
  while (sgnNum >= 0x20) {
    encoded += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
    sgnNum >>= 5;
  }
  encoded += String.fromCharCode(sgnNum + 63);
  return encoded;
}

/**
 * Encodes an array of LatLng points using Google's Encoded Polyline Algorithm.
 */
export function encodePolyline(points: Array<{ lat: number; lng: number }>): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';

  for (const pt of points) {
    const lat = Math.round(pt.lat * 1e5);
    const lng = Math.round(pt.lng * 1e5);
    result += encodeSignedNumber(lat - lastLat);
    result += encodeSignedNumber(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }

  return result;
}

function formatStaticLocation(place: PlaceSelection): string {
  if (typeof place.lat === 'number' && typeof place.lng === 'number') {
    return `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
  }
  return (place.address || place.name).trim();
}

export interface RouteStaticMapOptions {
  origin: PlaceSelection;
  destination: PlaceSelection;
  routePath?: Array<{ lat: number; lng: number }>;
  darkMode?: boolean;
  size?: string;
}

/**
 * Builds a Google Maps Static API URL for visually confirming a route thumbnail.
 * Docs: https://developers.google.com/maps/documentation/maps-static/overview?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 */
export function buildRouteStaticMapUrl(options: RouteStaticMapOptions): string {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '';
  if (!apiKey) return '';

  const originLoc = formatStaticLocation(options.origin);
  const destLoc = formatStaticLocation(options.destination);
  if (!originLoc || !destLoc) return '';

  const params = new URLSearchParams();
  params.append('size', options.size ?? '600x210');
  params.append('scale', '2');
  params.append('maptype', 'roadmap');
  params.append('markers', `size:mid|color:0x15803d|label:A|${originLoc}`);
  params.append('markers', `size:mid|color:0xd97706|label:B|${destLoc}`);

  if (options.routePath && options.routePath.length >= 2) {
    const encoded = encodePolyline(options.routePath);
    params.append(
      'path',
      `${options.darkMode ? 'color:0x60a5faff' : 'color:0x1d4ed8ff'}|weight:5|enc:${encoded}`
    );
  } else if (originLoc !== destLoc) {
    params.append(
      'path',
      `${options.darkMode ? 'color:0x60a5facc' : 'color:0x1d4ed8cc'}|weight:4|${originLoc}|${destLoc}`
    );
  }

  if (options.darkMode) {
    for (const style of DARK_MODE_MAP_STYLES) {
      params.append('style', style);
    }
  }

  params.append('key', apiKey);
  return `${STATIC_MAPS_BASE_URL}?${params.toString()}`;
}
