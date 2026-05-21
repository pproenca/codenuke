import { z } from "zod";
import {
  agentMapOutputSchema,
  fixPlanOutputSchema,
  reviewOutputSchema,
  revalidateOutputSchema,
} from "../platform/types.js";

const providerUnsupportedJsonSchemaKeywords = new Set([
  "$schema",
  "default",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maximum",
  "minimum",
  "multipleOf",
]);

export const agentMapJsonSchema = providerJsonSchema(agentMapOutputSchema);
export const reviewJsonSchema = providerJsonSchema(reviewOutputSchema);
export const revalidateJsonSchema = providerJsonSchema(revalidateOutputSchema);
export const fixPlanJsonSchema = providerJsonSchema(fixPlanOutputSchema);

export function providerJsonSchema(schema: z.ZodType): object {
  return normalizeProviderJsonSchema(z.toJSONSchema(schema)) as object;
}

function normalizeProviderJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeProviderJsonSchema);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (providerUnsupportedJsonSchemaKeywords.has(key)) {
      continue;
    }
    output[key] = normalizeProviderJsonSchema(item);
  }
  if (isJsonObject(output["properties"])) {
    output["required"] = Object.keys(output["properties"]);
    output["additionalProperties"] = false;
  }
  return output;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
