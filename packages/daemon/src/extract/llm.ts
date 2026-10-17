import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CandidateBatch } from "./schema.ts";
import { EXTRACTION_SYSTEM, renderExtractionInput, type ExtractInput } from "./prompt.ts";

export interface Extractor {
  extract(input: ExtractInput): Promise<CandidateBatch>;
}

export class ExtractionRefused extends Error {}

export class AnthropicExtractor implements Extractor {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async extract(input: ExtractInput): Promise<CandidateBatch> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(CandidateBatch), effort: "medium" },
      // The system prompt is identical across calls, so it caches.
      system: [{ type: "text", text: EXTRACTION_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderExtractionInput(input) }],
    });
    if (response.stop_reason === "refusal") {
      throw new ExtractionRefused(response.stop_details?.explanation ?? "extraction refused");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error("extraction output truncated (max_tokens)");
    }
    if (!response.parsed_output) throw new Error("extraction returned no parseable output");
    return response.parsed_output;
  }
}
