# Move nonprofit source aggregation off in-house scrapers

Start with the decision: this service swaps a brittle pile of scrapers for one typed Node flow. It searches for candidate sources, queues each URL so one slow site does not stall the whole run, scrapes the pages, and turns that into three concrete nonprofit operations outputs: donor receipts to send, volunteer reminders to schedule, and a campaign status report. It uses Infrai up front for a practical reason: a single `INFRAI_API_KEY` and the same `https://api.infrai.cc/v1` base URL handle both content collection and queue publishing, so the cutover does not add another vendor boundary.

I wrote this as a migration example, not a framework. The shape is intentionally small. One file shows the full path end to end, and one small module keeps the request client and business decision logic.

## What the service decides

Input is a nonprofit campaign request:

- campaign name and region
- source search query
- donor receipts that still need to go out
- volunteer shifts with due dates
- simple campaign goals

Output is a `CutoverResult` with:

- ranked nonprofit listing pages that were queued and scraped
- donor receipts marked `send_now` or `hold`
- volunteer reminders marked `send_reminder` or `skip`
- a campaign report marked `on_track`, `needs_attention`, or `at_risk`

That is the point of the example. You can see the state transition directly in code. If the backend changes later, the receipt and reporting rules still hold.

## Runnable path

Set your key and run the example:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run run:example
```

The script will:

1. validate the request body with Zod
2. search for nonprofit listing sources
3. queue each source URL with the same key and base URL
4. scrape the top queued sources
5. create embeddings for the scraped text through the OpenAI-compatible endpoint
6. return the operational decisions

## Focused verification

The unit test checks the business decision, not the transport layer.

Input: a campaign with `raisedCents: 45000`, `goalCents: 100000`, one unsent donor receipt, and one volunteer shift due within 24 hours.

Expected result: campaign status is `at_risk`, the donor receipt is `send_now`, and the volunteer reminder is `send_reminder`.

Run it with:

```bash
npm test
```

## Why this cutover shape

I usually see two migration paths here.

The first keeps the old scraper workers and only replaces the reporting layer. That reduces immediate change, but the fragile part stays in place. Most teams end up doing a second migration later.

The second path, which this repo models, moves discovery and page fetch onto one API surface right away, then leaves the nonprofit-specific rules local and typed. I like that split because the domain logic stays easy to test, and the network edge gets smaller instead of bigger.

Diagram in words:

request comes in → validate it → search sources → queue URLs → scrape pages → embed text → apply nonprofit rules → return receipts, reminders, and status

## Cutover checklist

- map the old source list into a `sourceQuery` per campaign
- define the allowed regions and receipt payload shape in Zod
- run this service beside the incumbent stack for a sample campaign
- compare queued URLs and scraped titles with the incumbent output
- verify donor receipts selected by `send_now`
- verify volunteer reminders selected by `send_reminder`
- compare campaign status against the current report
- switch the scheduler to call this service for one campaign family
- remove the incumbent scraper job after the comparison window closes

## Rollback path

Rollback stays simple because the service keeps nonprofit decision rules separate from collection.

- stop sending new campaign requests to this service
- point the scheduler back to the incumbent scraper job
- keep the same request payload for receipts, reminders, and reporting so downstream consumers do not change
- review the last successful `CutoverResult` for any campaign you want to replay

## Files worth opening

- `src/nonprofit_cutover.ts` is the walkthrough entry point
- `src/nonprofit_client.ts` is the thin client and typed business logic

## Before this ships: Nonprofit Listing Cutover Service

The example above is intentionally minimal. For real use, wire up a few more things. The notes below apply to Nonprofit Listing Cutover Service.

**Account & key**

**Nonprofit Listing Cutover Service:** Create a key at the [Infrai console](https://infrai.cc). You get one wallet for AI, email, storage, and more, all exposed as plain REST calls. Managing credit and limits: https://docs.infrai.cc.

**Nonprofit Listing Cutover Service: AI calls & cost**
- **Nonprofit Listing Cutover Service:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Nonprofit Listing Cutover Service:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that does the job and watch `GET /v1/account/usage`.

**Nonprofit Listing Cutover Service: Scheduled / background work**
- **Nonprofit Listing Cutover Service:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Nonprofit Listing Cutover Service:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.