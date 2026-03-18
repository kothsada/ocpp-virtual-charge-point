import * as uuid from "uuid";
import { sendAdminCommand } from "../../admin";

// Platform unit standard: all energy values stored as Wh (integer).
// kWh conversion happens only at display / billing time: energyKwh = Wh / 1000.
//
// Override via env vars:
//   TRANSACTION_ID=42 METER_WH=6000 POWER_KW=22 npx tsx admin/v16/Transaction/meterValues.ts
const transactionId = Number.parseInt(process.env.TRANSACTION_ID ?? "1");
const meterWh = Number.parseInt(process.env.METER_WH ?? "3000"); // Wh — e.g. 3000 Wh = 3 kWh
const powerKw = Number.parseFloat(process.env.POWER_KW ?? "22.0"); // kW instantaneous

sendAdminCommand({
  action: "MeterValues",
  messageId: uuid.v4(),
  payload: {
    connectorId: 1,
    transactionId,
    meterValue: [
      {
        timestamp: new Date(),
        sampledValue: [
          {
            // Instantaneous power — display only, not used for billing
            value: String(powerKw),
            measurand: "Power.Active.Import",
            unit: "kW",
            context: "Sample.Periodic",
          },
          {
            // Cumulative energy register — ALWAYS in Wh (integer) for this platform
            value: String(meterWh),
            measurand: "Energy.Active.Import.Register",
            unit: "Wh",
            context: "Sample.Periodic",
          },
        ],
      },
    ],
  },
});
