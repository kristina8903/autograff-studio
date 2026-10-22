// Hard cost cap for opt-in evaluations. Every call is estimated at its upper
// bound first and refused if it could take the total over the cap.
import { estimateMaxCost } from "@/lib/domain/pricing";
import { AnthropicProvider } from "@/lib/providers/llm/anthropic";
import { promptText, type StructuredRequest, type StructuredResult } from "@/lib/providers/llm/types";

export const EVAL_CAP_USD = 1;

export function evalEnabled(): boolean {
  return process.env.EVAL_CONFIRM === "1" && Boolean(process.env.ANTHROPIC_API_KEY?.startsWith("sk-ant-"));
}

export class CappedProvider {
  spent = 0;
  private readonly inner = new AnthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");
  constructor(private readonly cap = EVAL_CAP_USD) {}

  async generate<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const estimate = estimateMaxCost(request.model, promptText(request).length, request.maxOutputTokens);
    if (this.spent + estimate > this.cap)
      throw new Error(
        `Refused: this call could cost up to $${estimate.toFixed(2)}; $${this.spent.toFixed(2)} of the $${this.cap} cap is used.`,
      );
    const result = await this.inner.generateStructured(request);
    this.spent += result.usage.costUsd;
    return result;
  }
}
