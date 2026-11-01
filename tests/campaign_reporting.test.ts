import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalDecisions, campaignRequestSchema } from "../src/nonprofit_client";

test("campaign reporting marks at-risk campaigns and sends pending operations", () => {
  const input = campaignRequestSchema.parse({
    campaignName: "After School Meals",
    region: "Detroit",
    sourceQuery: "nonprofit meal support directory",
    goalCents: 100000,
    raisedCents: 45000,
    donorReceipts: [
      {
        donorName: "R. Gomez",
        amountCents: 2500,
        donatedAt: "2026-05-01T12:00:00Z",
        receiptSent: false
      }
    ],
    volunteerShifts: [
      {
        volunteerName: "Priya Shah",
        shiftStartsAt: "2026-05-02T08:00:00Z",
        reminderSent: false
      }
    ]
  });

  const result = buildOperationalDecisions(input, new Date("2026-05-01T12:00:00Z"));

  assert.equal(result.report.status, "at_risk");
  assert.equal(result.receiptDecisions[0]?.action, "send_now");
  assert.equal(result.volunteerDecisions[0]?.action, "send_reminder");
});
