import { NextResponse } from "next/server";
import { fetchRoute } from "@/lib/brouter";

// Confirms BRouter is running AND has NL/BE data + our profiles loaded, by
// asking for a tiny real route between two nearby points in Utrecht (NL).
export async function GET() {
  const probe = [
    { lon: 5.1214, lat: 52.0907 },
    { lon: 5.1249, lat: 52.0932 },
  ];
  try {
    const r = await fetchRoute(probe, "paved");
    return NextResponse.json({ ok: true, distanceKm: r.distanceKm });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
