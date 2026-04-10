import * as uuid from "uuid";
import { sendAdminCommand } from "../../admin";

// Optional overrides:
//   CONNECTOR_ID=2 METER_START=5000 ID_TAG=MOBILE_APP npx tsx admin/v16/Transaction/startTransaction.ts
const connectorId = Number.parseInt(process.env.CONNECTOR_ID ?? "1");
const meterStart = Number.parseInt(process.env.METER_START ?? "0"); // Wh
const idTag = process.env.ID_TAG ?? "MOBILE_APP";

sendAdminCommand({
  action: "StartTransaction",
  messageId: uuid.v4(),
  payload: {
    connectorId,
    idTag,
    meterStart,
    timestamp: new Date(),
  },
});
