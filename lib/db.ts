// Local SQLite storage for saved routes (better-sqlite3, single file in data/).

import "server-only";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { LonLat } from "./coords";
import type { Profile } from "./config";
import type { Direction } from "./generate";

export type SavedRouteSummary = {
  id: number;
  name: string;
  profile: Profile;
  distanceKm: number | null;
  direction: Direction | null;
  targetKm: number | null;
  createdAt: string;
};

export type SavedRoute = SavedRouteSummary & { waypoints: LonLat[] };

// Reuse one connection across requests and dev hot-reloads.
const globalForDb = globalThis as unknown as { _routeDb?: Database.Database };

function getDb(): Database.Database {
  if (globalForDb._routeDb) return globalForDb._routeDb;
  const dir = join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "routes.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      profile TEXT NOT NULL,
      waypoints TEXT NOT NULL,
      distance_km REAL,
      direction TEXT,
      target_km REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  globalForDb._routeDb = db;
  return db;
}

type Row = {
  id: number;
  name: string;
  profile: string;
  waypoints: string;
  distance_km: number | null;
  direction: string | null;
  target_km: number | null;
  created_at: string;
};

function toSummary(r: Row): SavedRouteSummary {
  return {
    id: r.id,
    name: r.name,
    profile: r.profile as Profile,
    distanceKm: r.distance_km,
    direction: (r.direction as Direction | null) ?? null,
    targetKm: r.target_km,
    createdAt: r.created_at,
  };
}

export function listRoutes(): SavedRouteSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, profile, waypoints, distance_km, direction, target_km, created_at
       FROM routes ORDER BY id DESC`,
    )
    .all() as Row[];
  return rows.map(toSummary);
}

export function getRoute(id: number): SavedRoute | null {
  const r = getDb()
    .prepare(
      `SELECT id, name, profile, waypoints, distance_km, direction, target_km, created_at
       FROM routes WHERE id = ?`,
    )
    .get(id) as Row | undefined;
  if (!r) return null;
  return { ...toSummary(r), waypoints: JSON.parse(r.waypoints) as LonLat[] };
}

export function insertRoute(data: {
  name: string;
  profile: Profile;
  waypoints: LonLat[];
  distanceKm: number | null;
  direction: Direction | null;
  targetKm: number | null;
}): SavedRoute {
  const info = getDb()
    .prepare(
      `INSERT INTO routes (name, profile, waypoints, distance_km, direction, target_km)
       VALUES (@name, @profile, @waypoints, @distanceKm, @direction, @targetKm)`,
    )
    .run({
      name: data.name,
      profile: data.profile,
      waypoints: JSON.stringify(data.waypoints),
      distanceKm: data.distanceKm,
      direction: data.direction,
      targetKm: data.targetKm,
    });
  return getRoute(Number(info.lastInsertRowid))!;
}

export function deleteRoute(id: number): boolean {
  return getDb().prepare(`DELETE FROM routes WHERE id = ?`).run(id).changes > 0;
}
