import { NextRequest, NextResponse } from "next/server";
import { fetchGpx, BrouterError } from "@/lib/brouter";
import { isProfile } from "@/lib/config";
import { parseWaypoints } from "@/lib/request";
import { setGpxTrackName } from "@/lib/gpx";

// POST { waypoints, profile, name } -> GPX 1.1 track (as a download).
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const { waypoints, profile, name } = body;
  if (!isProfile(profile)) {
    return NextResponse.json({ error: "Onbekend profiel." }, { status: 400 });
  }

  let points;
  try {
    points = parseWaypoints(waypoints);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ongeldige punten." },
      { status: 400 },
    );
  }

  try {
    const gpx = await fetchGpx(points, profile);
    const named = setGpxTrackName(gpx, typeof name === "string" ? name : "Route");
    return new NextResponse(named, {
      status: 200,
      headers: { "content-type": "application/gpx+xml; charset=utf-8" },
    });
  } catch (err) {
    const status = err instanceof BrouterError ? 422 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export mislukt." },
      { status },
    );
  }
}
