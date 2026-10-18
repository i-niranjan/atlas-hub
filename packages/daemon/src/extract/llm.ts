import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { UsageSink } from "../usage.ts";
import type { Feature } from "@atlas/core";
import type { z } from "zod";
import { DecisionBatch, RoadmapBatch, type CandidateBatch } from "./schema.ts";
import {
  EXTRACTION_SYSTEM,
  ROADMAP_SYSTEM,
  renderExtractionInput,
  type ExtractInput,
} from "./prompt.ts";

export interface Extractor {
  extract(input: ExtractInput): Promise<CandidateBatch>;
}

export class ExtractionRefused extends Error {}

export class AnthropicExtractor implements Extractor {
  private readonly client: Anthropic;
  private readonly model: string;

  private readonly onUsage: UsageSink | undefined;

  constructor(apiKey: string, model: string, onUsage?: UsageSink) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.onUsage = onUsage;
  }

  async extract(input: ExtractInput): Promise<CandidateBatch> {
    const content = renderExtractionInput(input);
    const needsRoadmap = !!input.trajectory || !!input.noRoadmap;
    // Two small calls instead of one large schema: the API caps structured-output grammar size.
    const [decisions, roadmap] = await Promise.all([
      this.call("decisions", EXTRACTION_SYSTEM, DecisionBatch, content, input.sessionProject.id),
      needsRoadmap
        ? this.call("roadmap", ROADMAP_SYSTEM, RoadmapBatch, content, input.sessionProject.id)
        : Promise.resolve({ progress: [], newPlan: null }),
    ]);
    return { entries: decisions.entries, progress: roadmap.progress, newPlan: roadmap.newPlan };
  }

  private async call<T extends z.ZodType>(
    feature: Feature,
    system: string,
    schema: T,
    content: string,
    projectId: string,
  ): Promise<z.infer<T>> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(schema), effort: "medium" },
      // Each system prompt is identical across calls, so it caches.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
    this.onUsage?.(feature, this.model, response.usage, projectId);
    if (response.stop_reason === "refusal") {
      throw new ExtractionRefused(response.stop_details?.explanation ?? "extraction refused");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("extraction output truncated (max_tokens)");
    }
    if (!response.parsed_output) throw new Error("extraction returned no parseable output");
    return response.parsed_output as z.infer<T>;
  }
}
