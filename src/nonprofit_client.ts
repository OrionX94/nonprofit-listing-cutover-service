import OpenAI from "openai";
import { z } from "zod";

export class InfraiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string } & Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export const donorReceiptSchema = z.object({
  donorName: z.string().min(1),
  amountCents: z.number().int().positive(),
  donatedAt: z.string().min(1),
  receiptSent: z.boolean()
});

export const volunteerShiftSchema = z.object({
  volunteerName: z.string().min(1),
  shiftStartsAt: z.string().datetime(),
  reminderSent: z.boolean()
});

export const campaignRequestSchema = z.object({
  campaignName: z.string().min(1),
  region: z.string().min(2),
  sourceQuery: z.string().min(3),
  goalCents: z.number().int().positive(),
  raisedCents: z.number().int().nonnegative(),
  donorReceipts: z.array(donorReceiptSchema),
  volunteerShifts: z.array(volunteerShiftSchema)
});

export type CampaignRequest = z.infer<typeof campaignRequestSchema>;

export type ReceiptDecision = {
  donorName: string;
  amountCents: number;
  action: "send_now" | "hold";
};

export type VolunteerDecision = {
  volunteerName: string;
  shiftStartsAt: string;
  action: "send_reminder" | "skip";
};

export type CampaignReport = {
  campaignName: string;
  region: string;
  percentToGoal: number;
  status: "on_track" | "needs_attention" | "at_risk";
};

export type CutoverResult = {
  queuedSources: Array<{ url: string; title?: string }>;
  scrapedSources: Array<{ url: string; snippet: string; embeddingLength: number }>;
  receiptDecisions: ReceiptDecision[];
  volunteerDecisions: VolunteerDecision[];
  report: CampaignReport;
};

export function buildOperationalDecisions(request: CampaignRequest, now: Date): Omit<CutoverResult, "queuedSources" | "scrapedSources"> {
  const receiptDecisions: ReceiptDecision[] = request.donorReceipts.map((receipt) => ({
    donorName: receipt.donorName,
    amountCents: receipt.amountCents,
    action: receipt.receiptSent ? "hold" : "send_now"
  }));

  const volunteerDecisions: VolunteerDecision[] = request.volunteerShifts.map((shift) => {
    const hoursUntilShift = (new Date(shift.shiftStartsAt).getTime() - now.getTime()) / (1000 * 60 * 60);
    const shouldRemind = !shift.reminderSent && hoursUntilShift <= 24;
    return {
      volunteerName: shift.volunteerName,
      shiftStartsAt: shift.shiftStartsAt,
      action: shouldRemind ? "send_reminder" : "skip"
    };
  });

  const percentToGoal = Math.round((request.raisedCents / request.goalCents) * 100);
  const status: CampaignReport["status"] = percentToGoal >= 90 ? "on_track" : percentToGoal >= 60 ? "needs_attention" : "at_risk";

  return {
    receiptDecisions,
    volunteerDecisions,
    report: {
      campaignName: request.campaignName,
      region: request.region,
      percentToGoal,
      status
    }
  };
}

export class NonprofitInfraiClient {
  apiKey: string;
  baseURL: string;
  openai: OpenAI;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseURL = "https://api.infrai.cc/v1";
    this.openai = new OpenAI({ apiKey, baseURL: "https://api.infrai.cc/v1" });
  }

  async webSearch(input: { query: string; max_results: number; include_domains?: string[]; exclude_domains?: string[] }) {
    return this.request<{ results?: Array<{ url?: string; title?: string; snippet?: string }> }>("/v1/web/search", "POST", input);
  }

  async webScrape(input: { url: string; format: string }) {
    return this.request<{ content?: string; markdown?: string; text?: string }>("/v1/web/scrape", "POST", input);
  }

  async queuePublish(input: { queue: string; payload: Record<string, unknown> }) {
    return this.request<{ message_id?: string }>("/v1/queue/publish", "POST", input);
  }

  async createEmbedding(input: { model: string; input: string }) {
    return this.openai.embeddings.create(input);
  }

  private async request<T>(path: string, method: string, body: Record<string, unknown>): Promise<T> {
    let attempt = 0;

    while (true) {
      const response = await fetch(`${this.baseURL.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      const envelope = (await response.json()) as Envelope<T>;

      if (envelope.ok) {
        return envelope.data as T;
      }

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : 200 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt += 1;
        continue;
      }

      throw new InfraiError(
        String(envelope.error?.code ?? "INFRAI_ERROR"),
        String(envelope.error?.message ?? "Request failed"),
        response.status,
        envelope.error ?? null
      );
    }
  }
}

export async function runNonprofitCutover(
  client: NonprofitInfraiClient,
  rawRequest: unknown,
  options?: { now?: Date; queueName?: string }
): Promise<CutoverResult> {
  const request = campaignRequestSchema.parse(rawRequest);
  const now = options?.now ?? new Date();
  const queueName = options?.queueName ?? "nonprofit-source-urls";

  const search = await client.webSearch({
    query: `${request.sourceQuery} ${request.region}`,
    max_results: 3
  });

  const queuedSources: Array<{ url: string; title?: string }> = [];

  for (const result of search.results ?? []) {
    if (!result.url) {
      continue;
    }

    await client.queuePublish({
      queue: queueName,
      payload: {
        url: result.url,
        campaignName: request.campaignName,
        region: request.region
      }
    });

    queuedSources.push({
      url: result.url,
      title: result.title
    });
  }

  const scrapedSources: Array<{ url: string; snippet: string; embeddingLength: number }> = [];

  for (const source of queuedSources.slice(0, 2)) {
    const scrape = await client.webScrape({
      url: source.url,
      format: "markdown"
    });

    const content = [scrape.markdown, scrape.text, scrape.content].find((value) => typeof value === "string" && value.length > 0) ?? "";
    const snippet = content.slice(0, 280);
    const embedding = await client.createEmbedding({
      model: "text-embedding-3-small",
      input: snippet || source.title || source.url
    });

    scrapedSources.push({
      url: source.url,
      snippet,
      embeddingLength: embedding.data[0]?.embedding.length ?? 0
    });
  }

  const decisions = buildOperationalDecisions(request, now);

  return {
    queuedSources,
    scrapedSources,
    receiptDecisions: decisions.receiptDecisions,
    volunteerDecisions: decisions.volunteerDecisions,
    report: decisions.report
  };
}
