import { NonprofitInfraiClient, runNonprofitCutover } from "./nonprofit_client";

async function main() {
  const apiKey = process.env.INFRAI_API_KEY;

  if (!apiKey) {
    throw new Error("Set INFRAI_API_KEY in your environment before running this example.");
  }

  const client = new NonprofitInfraiClient(apiKey);

  const result = await runNonprofitCutover(
    client,
    {
      campaignName: "Community Pantry Spring Drive",
      region: "Chicago",
      sourceQuery: "nonprofit food pantry directory",
      goalCents: 100000,
      raisedCents: 72000,
      donorReceipts: [
        {
          donorName: "Ana Ruiz",
          amountCents: 5000,
          donatedAt: "2026-04-15T12:00:00Z",
          receiptSent: false
        },
        {
          donorName: "M. Chen",
          amountCents: 10000,
          donatedAt: "2026-04-14T09:30:00Z",
          receiptSent: true
        }
      ],
      volunteerShifts: [
        {
          volunteerName: "Leah Johnson",
          shiftStartsAt: "2026-04-16T10:00:00Z",
          reminderSent: false
        },
        {
          volunteerName: "Sam Patel",
          shiftStartsAt: "2026-04-20T15:00:00Z",
          reminderSent: false
        }
      ]
    },
    {
      now: new Date("2026-04-15T12:00:00Z"),
      queueName: "nonprofit-source-urls"
    }
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
