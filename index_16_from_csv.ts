require("dotenv").config();

import * as fs from "fs";
import * as path from "path";
import { OcppVersion } from "./src/ocppVersion";
import { bootNotificationOcppMessage } from "./src/v16/messages/bootNotification";
import { statusNotificationOcppMessage } from "./src/v16/messages/statusNotification";
import { VCP } from "./src/vcp";

/**
 * Reads chargers from a CSV file and spins up a VCP for each one.
 * Uses the ocpp_identity column as the chargePointId.
 * Usage: npm start index_16_from_csv.ts
 * Optional env: CSV_PATH (default: tohsamples/chargers.csv), ACTIVE_ONLY (default: true)
 */

const csvPath = process.env.CSV_PATH ?? path.join(__dirname, "tohsamples/chargers.csv");
const activeOnly = (process.env.ACTIVE_ONLY ?? "true") !== "false";

function parseCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").trim()]));
  });
}

function mapStatus(csvStatus: string): string {
  switch (csvStatus) {
    case "ONLINE":
      return "Available";
    case "OFFLINE":
      return "Unavailable";
    case "MAINTENANCE":
      return "Faulted";
    case "COMING_SOON":
      return "Unavailable";
    default:
      return "Available";
  }
}

(async () => {
  const chargers = parseCSV(csvPath);
  const filtered = activeOnly ? chargers.filter((c) => c.is_active === "true") : chargers;

  console.log(`Loaded ${filtered.length} chargers from ${csvPath}`);

  for (const charger of filtered) {
    const ocppIdentity = charger.ocpp_identity;
    if (!ocppIdentity) continue;

    const vcp = new VCP({
      endpoint: process.env.WS_URL ?? "ws://localhost:3000",
      chargePointId: ocppIdentity,
      ocppVersion: OcppVersion.OCPP_1_6,
      basicAuthPassword: process.env.PASSWORD ?? undefined,
    });

    vcp.connect().then(() => {
      vcp.send(
        bootNotificationOcppMessage.request({
          chargePointVendor: "PandaEV",
          chargePointModel: "VirtualChargePoint",
          firmwareVersion: charger.firmware_version || "1.0.0",
        }),
      );
      vcp.send(
        statusNotificationOcppMessage.request({
          connectorId: 1,
          errorCode: "NoError",
          status: mapStatus(charger.status),
        }),
      );
    });

    await new Promise((r) => setTimeout(r, 100));
  }
})();
