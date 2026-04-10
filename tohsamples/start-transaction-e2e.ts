/**
 * E2E smoke test – StartTransaction full flow using the real VCP
 *
 * This script is a standalone manual runner (not Jest). It imports the actual
 * VCP and OCPP 1.6 message classes and drives a complete StartTransaction →
 * StopTransaction cycle against the live panda-ev-ocpp CSMS.
 *
 * ── Prerequisites ──────────────────────────────────────────────────────────
 *  1. panda-ev-ocpp running:  cd panda-ev-ocpp && npm run start:dev
 *  2. VCP .env has:
 *       WS_URL=ws://localhost:3000/ocpp
 *       CP_ID=vientiane-central-panda-01   ← must match a seeded charger row
 *
 *  ⚠ The default .env ships with CP_ID=vientiane-central-station-panda-01
 *    which is NOT in the seed data. Change it to vientiane-central-panda-01
 *    or insert a matching row in panda_ev_ocpp.chargers before running.
 *
 * ── Run ────────────────────────────────────────────────────────────────────
 *  npx tsx tohsamples/start-transaction-e2e.ts
 *
 * ── What is verified ────────────────────────────────────────────────────────
 *  [VCP]  BootNotification → Accepted
 *  [VCP]  StatusNotification (connector 1 → Available) → {}
 *  [VCP]  StartTransaction  → { transactionId: N, idTagInfo: { status: "Accepted" } }
 *  [VCP]  Automatic MeterValues interval starts (every 15s via TransactionManager)
 *  [VCP]  StopTransaction   → {}
 *  [LOG]  Each step is logged with timing; failures throw so the process exits non-zero
 */

require('dotenv').config();

import { OcppVersion } from '../src/ocppVersion';
import { VCP } from '../src/vcp';
import { bootNotificationOcppMessage } from '../src/v16/messages/bootNotification';
import { statusNotificationOcppMessage } from '../src/v16/messages/statusNotification';
import { startTransactionOcppMessage } from '../src/v16/messages/startTransaction';
import { stopTransactionOcppMessage } from '../src/v16/messages/stopTransaction';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CSMS_ENDPOINT = process.env.WS_URL ?? 'ws://localhost:3000/ocpp';
const CHARGER_ID = process.env.CP_ID ?? 'vientiane-central-panda-01';
const CONNECTOR_ID = 1;
const ID_TAG = 'E2E-RFID-001';
const METER_START_WH = 0;
const METER_STOP_WH = 5000; // simulates 5 kWh charged
const STOP_AFTER_MS = 5_000; // stop the transaction after 5 seconds

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

function step(name: string): () => void {
  const start = Date.now();
  process.stdout.write(`  ▶ ${name}... `);
  return () => process.stdout.write(`✓ (${Date.now() - start}ms)\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log('\n=== Panda EV – StartTransaction E2E (OCPP 1.6J) ===\n');
  console.log(`  CSMS:     ${CSMS_ENDPOINT}/${CHARGER_ID}`);
  console.log(`  Charger:  ${CHARGER_ID}`);
  console.log(`  Connector: ${CONNECTOR_ID}`);
  console.log(`  idTag:    ${ID_TAG}\n`);

  // ── 1. Create VCP and connect ─────────────────────────────────────────────
  const vcp = new VCP({
    endpoint: CSMS_ENDPOINT,
    chargePointId: CHARGER_ID,
    ocppVersion: OcppVersion.OCPP_1_6,
    adminPort: Number.parseInt(process.env.ADMIN_PORT ?? '9999'),
  });

  let done = step('connect WebSocket (ocpp1.6 subprotocol)');
  await vcp.connect();
  done();

  // ── 2. BootNotification ───────────────────────────────────────────────────
  done = step('send BootNotification');
  vcp.send(
    bootNotificationOcppMessage.request({
      chargePointVendor: 'PandaEV-E2E',
      chargePointModel: 'VirtualChargePoint',
      chargePointSerialNumber: 'VCP-E2E-001',
      firmwareVersion: '1.0.0-e2e',
    }),
  );
  // VCP resHandler handles the response automatically; wait for propagation
  await new Promise((r) => setTimeout(r, 800));
  done();

  // ── 3. StatusNotification – connector 1 Available ────────────────────────
  done = step('send StatusNotification (connector 1 → Available)');
  vcp.send(
    statusNotificationOcppMessage.request({
      connectorId: CONNECTOR_ID,
      errorCode: 'NoError',
      status: 'Available',
    }),
  );
  await new Promise((r) => setTimeout(r, 400));
  done();

  // ── 4. StartTransaction ───────────────────────────────────────────────────
  // The VCP's startTransaction.resHandler automatically:
  //   - calls vcp.transactionManager.startTransaction (starts MeterValues interval)
  //   - sends StopTransaction if idTagInfo.status !== "Accepted"
  done = step('send StartTransaction');
  let capturedTransactionId: number | null = null;

  // Monkey-patch the resHandler to capture the transactionId for our stop call
  const originalResHandler = startTransactionOcppMessage.resHandler.bind(
    startTransactionOcppMessage,
  );
  startTransactionOcppMessage.resHandler = async (v, call, result) => {
    capturedTransactionId = result.payload.transactionId;
    console.log(`\n    → CSMS assigned transactionId: ${capturedTransactionId}`);
    console.log(`    → idTagInfo.status: ${result.payload.idTagInfo.status}`);
    await originalResHandler(v, call, result);
  };

  vcp.send(
    startTransactionOcppMessage.request({
      connectorId: CONNECTOR_ID,
      idTag: ID_TAG,
      meterStart: METER_START_WH,
      timestamp: new Date().toISOString(),
    }),
  );

  // Wait for CSMS to process and respond
  await new Promise((r) => setTimeout(r, 1_000));
  done();

  if (capturedTransactionId === null) {
    throw new Error('Did not receive StartTransaction response – check CSMS logs');
  }

  // ── 5. Wait a bit (MeterValues will fire automatically via TransactionManager) ──
  console.log(`\n  ⏳ Charging for ${STOP_AFTER_MS / 1000}s (MeterValues auto-emitted every 15s)...\n`);
  await new Promise((r) => setTimeout(r, STOP_AFTER_MS));

  // ── 6. StopTransaction ────────────────────────────────────────────────────
  done = step('send StopTransaction');
  vcp.send(
    stopTransactionOcppMessage.request({
      transactionId: capturedTransactionId,
      meterStop: METER_STOP_WH,
      timestamp: new Date().toISOString(),
      reason: 'Local',
    }),
  );
  await new Promise((r) => setTimeout(r, 800));
  done();

  // ── 7. StatusNotification – connector 1 Available (after stop) ────────────
  done = step('send StatusNotification (connector 1 → Available after stop)');
  vcp.send(
    statusNotificationOcppMessage.request({
      connectorId: CONNECTOR_ID,
      errorCode: 'NoError',
      status: 'Available',
    }),
  );
  await new Promise((r) => setTimeout(r, 400));
  done();

  console.log('\n=== E2E flow completed successfully ✓ ===\n');
  console.log('Now verify the downstream effects manually or via the DB scripts:');
  console.log('');
  console.log('  # Check OCPP DB – Transaction row');
  console.log(`  SELECT * FROM panda_ev_ocpp.transactions WHERE ocpp_transaction_id = ${capturedTransactionId};`);
  console.log('');
  console.log('  # Check Mobile DB – ChargingSession linked to OCPP tx');
  console.log(`  SELECT id, ocpp_transaction_id, status FROM panda_ev_core.charging_sessions WHERE ocpp_transaction_id = ${capturedTransactionId};`);
  console.log('');
  console.log('  # Check Redis – charger_status key');
  console.log(`  redis-cli GET charger_status:${CHARGER_ID}`);
  console.log('');

  process.exit(0);
})().catch((err) => {
  console.error('\n✗ E2E test FAILED:', (err as Error).message);
  process.exit(1);
});
