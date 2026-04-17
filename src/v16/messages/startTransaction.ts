import { z } from "zod";
import {
  type OcppCall,
  type OcppCallResult,
  OcppOutgoing,
} from "../../ocppMessage";
import type { VCP } from "../../vcp";
import { ConnectorIdSchema, IdTagInfoSchema, IdTokenSchema } from "./_common";
import { meterValuesOcppMessage } from "./meterValues";
import { statusNotificationOcppMessage } from "./statusNotification";
import { stopTransactionOcppMessage } from "./stopTransaction";

const StartTransactionReqSchema = z.object({
  connectorId: ConnectorIdSchema,
  idTag: IdTokenSchema,
  meterStart: z.number().int(),
  reservationId: z.number().int().nullish(),
  timestamp: z.string().datetime(),
});
type StartTransactionReqType = typeof StartTransactionReqSchema;

const StartTransactionResSchema = z.object({
  idTagInfo: IdTagInfoSchema,
  transactionId: z.number().int(),
});
type StartTransactionResType = typeof StartTransactionResSchema;

class StartTransactionOcppMessage extends OcppOutgoing<
  StartTransactionReqType,
  StartTransactionResType
> {
  resHandler = async (
    vcp: VCP,
    call: OcppCall<z.infer<StartTransactionReqType>>,
    result: OcppCallResult<z.infer<StartTransactionResType>>,
  ): Promise<void> => {
    vcp.transactionManager.startTransaction(vcp, {
      transactionId: result.payload.transactionId,
      idTag: call.payload.idTag,
      connectorId: call.payload.connectorId,
      meterValuesCallback: async (transactionState) => {
        const elapsedMinutes =
          (Date.now() - transactionState.startedAt.getTime()) / 60000;
        // SoC rises from 80 → 100 % over ~40 minutes (0.5 %/min).
        // Capped at 100 so OCPP's SoC-based auto-stop path (threshold ≥ 100%)
        // is exercised correctly in simulator tests.
        const soc = Math.min(100, Math.round(80 + elapsedMinutes * 0.5));
        vcp.send(
          meterValuesOcppMessage.request({
            connectorId: call.payload.connectorId,
            transactionId: result.payload.transactionId,
            meterValue: [
              {
                timestamp: new Date().toISOString(),
                sampledValue: [
                  {
                    value: (transactionState.meterValue / 1000).toString(),
                    measurand: "Energy.Active.Import.Register",
                    unit: "kWh",
                  },
                  {
                    value: "220.0",
                    measurand: "Voltage",
                    unit: "V",
                  },
                  {
                    value: "16.0",
                    measurand: "Current.Import",
                    unit: "A",
                  },
                  {
                    value: "3520.0",
                    measurand: "Power.Active.Import",
                    unit: "W",
                  },
                  {
                    value: soc.toString(),
                    measurand: "SoC",
                    unit: "Percent",
                    location: "EV",
                  },
                ],
              },
            ],
          }),
        );

        // When battery is full (SoC 100 %), send StopTransaction so OCPP can
        // finalise the session and publish transaction.stopped for billing.
        // stopTransaction() clears the meter-values interval first to prevent
        // a duplicate StopTransaction on the next tick.
        if (soc >= 100) {
          vcp.transactionManager.stopTransaction(result.payload.transactionId);
          vcp.send(
            stopTransactionOcppMessage.request({
              transactionId: result.payload.transactionId,
              meterStop: Math.round(transactionState.meterValue),
              reason: "EVDisconnected",
              timestamp: new Date().toISOString(),
            }),
          );
          vcp.send(
            statusNotificationOcppMessage.request({
              connectorId: call.payload.connectorId,
              errorCode: "NoError",
              status: "Available",
            }),
          );
        }
      },
    });
    if (result.payload.idTagInfo.status !== "Accepted") {
      vcp.send(
        stopTransactionOcppMessage.request({
          transactionId: result.payload.transactionId,
          meterStop: 0,
          reason: "DeAuthorized",
          timestamp: new Date().toISOString(),
        }),
      );
      vcp.send(
        statusNotificationOcppMessage.request({
          connectorId: call.payload.connectorId,
          errorCode: "NoError",
          status: "Available",
        }),
      );
      return;
    }
  };
}

export const startTransactionOcppMessage = new StartTransactionOcppMessage(
  "StartTransaction",
  StartTransactionReqSchema,
  StartTransactionResSchema,
);
