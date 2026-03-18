import * as uuid from "uuid";
import { sendAdminCommand } from "../../admin";

// Pass TRANSACTION_ID and METER_STOP via env vars:
//   TRANSACTION_ID=42 METER_STOP=15000 npx tsx admin/v16/Transaction/stopTransaction.ts
const transactionId = Number.parseInt(process.env.TRANSACTION_ID ?? "1");
const meterStop = Number.parseInt(process.env.METER_STOP ?? "15000"); // Wh

sendAdminCommand({
  action: "StopTransaction",
  messageId: uuid.v4(),
  payload: {
    transactionId,
    timestamp: new Date(),
    meterStop,
    reason: "Local",
  },
});
