import { NextResponse } from "next/server";
import { getRoute, deleteRoute } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

// GET -> a single saved route including its waypoints (for loading)
export async function GET(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Ongeldig id." }, { status: 400 });
  }
  const route = getRoute(id);
  if (!route) {
    return NextResponse.json({ error: "Route niet gevonden." }, { status: 404 });
  }
  return NextResponse.json(route);
}

// DELETE -> remove a saved route
export async function DELETE(_req: Request, { params }: Ctx) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Ongeldig id." }, { status: 400 });
  }
  const ok = deleteRoute(id);
  if (!ok) {
    return NextResponse.json({ error: "Route niet gevonden." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
