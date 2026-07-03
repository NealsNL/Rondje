import { NextRequest, NextResponse } from "next/server";
import { listRoutes, insertRoute } from "@/lib/db";
import { isProfile, isTripType } from "@/lib/config";
import { isDirection } from "@/lib/generate";
import { parseWaypoints } from "@/lib/request";

// GET -> list of saved routes (summaries)
export async function GET() {
  return NextResponse.json(listRoutes());
}

// POST { name, profile, waypoints, distanceKm?, direction?, targetKm? } -> saved route
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Geef de route een naam." }, { status: 400 });
  }
  if (!isProfile(body.profile)) {
    return NextResponse.json({ error: "Onbekend profiel." }, { status: 400 });
  }

  let waypoints;
  try {
    waypoints = parseWaypoints(body.waypoints);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ongeldige punten." },
      { status: 400 },
    );
  }

  const distanceKm = Number.isFinite(Number(body.distanceKm))
    ? Number(body.distanceKm)
    : null;
  const targetKm = Number.isFinite(Number(body.targetKm))
    ? Number(body.targetKm)
    : null;
  const direction = isDirection(body.direction) ? body.direction : null;

  const saved = insertRoute({
    name,
    profile: body.profile,
    tripType: isTripType(body.tripType) ? body.tripType : "loop",
    waypoints,
    distanceKm,
    direction,
    targetKm,
  });
  return NextResponse.json(saved, { status: 201 });
}
