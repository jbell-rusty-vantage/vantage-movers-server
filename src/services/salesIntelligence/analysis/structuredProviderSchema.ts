import type { Schema } from "ai" with { "resolution-mode": "import" };
import type { z } from "zod";

type JsonSchema = Awaited<Schema["jsonSchema"]>;

/** Disjoint literal-tagged branches accept exactly the same values under anyOf and oneOf. */
export function providerCompatibleSchema(schema: JsonSchema): JsonSchema {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
    if (Array.isArray(result.oneOf)) {
      const branches = result.oneOf as JsonSchema[];
      const tags = Object.keys(branches[0]?.properties ?? {});
      const disjoint = tags.some(tag => {
        const values = branches.map(branch => {
          const property = branch.properties?.[tag];
          return !branch.$ref && branch.type === "object" && branch.required?.includes(tag) &&
            property && typeof property === "object" && !property.$ref && typeof property.const === "string" ? property.const : undefined;
        });
        return values.every(value => value !== undefined) && new Set(values).size === branches.length;
      });
      if (!disjoint || result.anyOf) throw new Error("Unsupported structured provider union");
      result.anyOf = result.oneOf;
      delete result.oneOf;
    }
    return result;
  }
  return visit(schema) as JsonSchema;
}

/** Transport adaptation only: preserve the original Zod validator and pinned logical contract. */
export async function structuredProviderSchema(schema: z.ZodType) {
  const { jsonSchema, zodSchema } = await import("ai");
  const original = zodSchema(schema);
  return jsonSchema(providerCompatibleSchema(await original.jsonSchema), { validate: original.validate });
}
