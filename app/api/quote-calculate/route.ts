export const dynamic = 'force-dynamic';
// app/api/quote-calculate/route.ts
// Calculates route distances using OpenRouteService (free, no billing required)
// POST /api/quote-calculate

import { NextRequest, NextResponse } from 'next/server';

const HOME_BASE_LAT = -34.5213;
const HOME_BASE_LNG = 138.7492; // Roseworthy SA

const SA_REVIEW_KM_THRESHOLD = 350;
const ORS_API_KEY = process.env.ORS_API_KEY!.trim();

// Validate coordinates are within South Australia
function isWithinSA(lat: number, lng: number): boolean {
  return lat >= -38.1 && lat <= -25.9 && lng >= 128.9 && lng <= 141.1;
}

// Geocode an address string to lat/lng using Nominatim (free, no key needed)
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&countrycodes=au&addressdetails=1&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CaspersTransport/1.0 (benjamin@havocsolutions.au)' },
  });
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const result = data[0];
  // Verify it's in SA
  if (result.address?.state !== 'South Australia') return null;
  return { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
}

// Get road distance in metres and duration in seconds — OSRM primary, ORS fallback
async function getRouteMetrics(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<{ distanceM: number; durationS: number }> {
  // Try OSRM first (no API key, no rate limit)
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const res  = await fetch(osrmUrl, { headers: { 'User-Agent': 'CaspersTransport/1.0 (benjamin@havocsolutions.au)' } });
    const data = await res.json();
    const route = data?.routes?.[0];
    if (route) return { distanceM: route.distance, durationS: route.duration };
  } catch (_) { /* fall through to ORS */ }

  // Fallback: ORS
  const orsUrl = 'https://api.openrouteservice.org/v2/directions/driving-car';
  const res = await fetch(orsUrl, {
    method: 'POST',
    headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[fromLng, fromLat], [toLng, toLat]] }),
  });
  const data = await res.json();
  const summary = data?.routes?.[0]?.summary;
  if (!summary) throw new Error('Route calculation failed');
  return { distanceM: summary.distance, durationS: summary.duration };
}

export async function POST(req: NextRequest) {
  try {
    const { pickupAddress, dropoffAddress, pickupCoords, dropoffCoords } = await req.json();

    if (!pickupAddress || !dropoffAddress) {
      return NextResponse.json({ success: false, error: 'Missing addresses' }, { status: 400 });
    }

    // Use pre-resolved coords from form if available, otherwise geocode server-side
    let pickup = pickupCoords ?? await geocode(pickupAddress);
    let dropoff = dropoffCoords ?? await geocode(dropoffAddress);

    if (!pickup) return NextResponse.json({ success: false, error: 'Could not locate pickup address in SA.' }, { status: 422 });
    if (!dropoff) return NextResponse.json({ success: false, error: 'Could not locate dropoff address in SA.' }, { status: 422 });

    if (!isWithinSA(pickup.lat, pickup.lng)) {
      return NextResponse.json({ success: false, error: 'Pickup address must be in South Australia.' }, { status: 422 });
    }
    if (!isWithinSA(dropoff.lat, dropoff.lng)) {
      return NextResponse.json({ success: false, error: 'Dropoff address must be in South Australia.' }, { status: 422 });
    }

    // Run all three legs in parallel: base→pickup, pickup→dropoff, dropoff→base
    const [leg1, leg2, leg3] = await Promise.all([
      getRouteMetrics(HOME_BASE_LAT, HOME_BASE_LNG, pickup.lat, pickup.lng),
      getRouteMetrics(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng),
      getRouteMetrics(dropoff.lat, dropoff.lng, HOME_BASE_LAT, HOME_BASE_LNG),
    ]);

    const kmToPickup           = Math.ceil(leg1.distanceM / 1000);
    const kmLoaded             = Math.ceil(leg2.distanceM / 1000);
    const kmReturn             = Math.ceil(leg3.distanceM / 1000);
    const driveToPickupMinutes = Math.ceil(leg1.durationS / 60);
    const driveLoadedMinutes   = Math.ceil(leg2.durationS / 60);
    const driveReturnMinutes   = Math.ceil(leg3.durationS / 60);

    const totalKm    = kmToPickup + kmLoaded;
    const needsReview = totalKm > SA_REVIEW_KM_THRESHOLD;

    return NextResponse.json({
      success: true,
      kmToPickup,
      kmLoaded,
      kmReturn,
      driveToPickupMinutes,
      driveLoadedMinutes,
      driveReturnMinutes,
      totalKm,
      needsReview,
      reviewReason: needsReview ? `Long distance job (${totalKm} km) — verify quote and logistics` : null,
    });

  } catch (err: any) {
    console.error('quote-calculate error:', err);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
