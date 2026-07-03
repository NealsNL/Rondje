// Starts the local BRouter routing server using the bundled Java runtime.
// No system-wide Java or Docker needed. Keep this window open while planning.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brouter = join(root, "brouter");
const segments = join(brouter, "segments4");
const profiles = join(brouter, "profiles2");
const customProfiles = join(brouter, "customprofiles");
const port = process.env.BROUTER_PORT ?? "17777";

const java =
  process.platform === "win32"
    ? join(brouter, "jre", "bin", "java.exe")
    : join(brouter, "jre", "bin", "java");

function fail(msg) {
  console.error(`\n[BRouter] ${msg}\n`);
  process.exit(1);
}

if (!existsSync(java)) {
  fail(
    "Java-runtime niet gevonden in brouter/jre. Download de onderdelen met:\n" +
      "  powershell -ExecutionPolicy Bypass -File scripts\\download-brouter.ps1",
  );
}

const jar = existsSync(brouter)
  ? readdirSync(brouter).find((f) => f.endsWith("-all.jar"))
  : undefined;
if (!jar) fail("brouter-*-all.jar niet gevonden in de brouter-map.");

const rd5 = existsSync(segments)
  ? readdirSync(segments).filter((f) => f.endsWith(".rd5"))
  : [];
if (rd5.length === 0) {
  fail(
    "Geen kaartdata (.rd5) gevonden in brouter/segments4. " +
      "Download de segmenten (zie README).",
  );
}

console.log(`[BRouter] Java:     ${java}`);
console.log(`[BRouter] Jar:      ${jar}`);
console.log(`[BRouter] Segments: ${rd5.length} tegel(s)`);
console.log(`[BRouter] Poort:    ${port} (alleen localhost)`);
console.log("[BRouter] Starten… (laat dit venster open)\n");

const args = [
  "-Xmx1024M",
  "-DmaxRunningTime=300",
  "-cp",
  join(brouter, jar),
  "btools.server.RouteServer",
  segments,
  profiles,
  customProfiles,
  port,
  "4",
  "127.0.0.1",
];

const child = spawn(java, args, { cwd: brouter, stdio: "inherit" });

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
