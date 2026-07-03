import { NextRequest, NextResponse } from "next/server";
import { BrouterError } from "@/lib/brouter";
import { routeWithoutDetours } from "@/lib/generate";
import { clampQuietness, isProfile } from "@/lib/config";
import { parseWaypoints } from "@/lib/request";

// POST { waypoints: [{lon,lat}, ...], profile: "paved"|"unpaved" }
// -> { coordinates, distanceKm, ascendMeters }
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const { waypoints, profile, quietness } = (body ?? {}) as Record<string, unknown>;
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
    const { result, keptIndices } = await routeWithoutDetours(
      points,
      profile,
      clampQuietness(quietness),
    );
    // keptIndices lets the client drop the same detour-causing waypoints, so its
    // markers match the cleaned route.
    return NextResponse.json({ ...result, keptIndices });
  } catch (err) {
    const status = err instanceof BrouterError ? 422 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Routeren mislukt." },
      { status },
    );
  }
}
