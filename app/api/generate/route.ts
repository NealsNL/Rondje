import { NextRequest, NextResponse } from "next/server";
import { generateLoop, isDirection } from "@/lib/generate";
import { BrouterError } from "@/lib/brouter";
import { isProfile } from "@/lib/config";
import { parseWaypoints } from "@/lib/request";

// POST { start:{lon,lat}, end?:{lon,lat}, direction:"N".."NW",
//        distanceKm:number, profile:"paved"|"unpaved" }
// -> { waypoints, distanceKm, ascendMeters, coordinates, withinTolerance }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const { start, end, direction, distanceKm, profile } = body;

  if (!isProfile(profile)) {
    return NextResponse.json({ error: "Onbekend profiel." }, { status: 400 });
  }
  if (!isDirection(direction)) {
    return NextResponse.json({ error: "Onbekende richting." }, { status: 400 });
  }
  const targetKm = Number(distanceKm);
  if (!Number.isFinite(targetKm) || targetKm < 2 || targetKm > 300) {
    return NextResponse.json(
      { error: "Kies een afstand tussen 2 en 300 km." },
      { status: 400 },
    );
  }

  // Reuse waypoint validation: start (and optional end) must be valid points.
  let startPoint, endPoint;
  try {
    const pts = parseWaypoints(end != null ? [start, end] : [start, start]);
    startPoint = pts[0];
    endPoint = end != null ? pts[1] : undefined;
  } catch {
    return NextResponse.json({ error: "Ongeldig startpunt." }, { status: 400 });
  }

  try {
    const result = await generateLoop({
      start: startPoint,
      end: endPoint,
      direction,
      targetKm,
      profile,
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof BrouterError ? 422 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Genereren mislukt." },
      { status },
    );
  }
}
