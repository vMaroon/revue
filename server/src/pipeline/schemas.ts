// Zod schemas for every stage's JSON output, plus runJson: the single path
// through which the pipeline asks an agent for structured output.

import { z } from 'zod';
import type { AgentInvoker, AgentRunOptions } from '../interfaces';
import { elog } from '../log';

const SeveritySchema = z.enum(['blocking', 'suggestion', 'nit']);
const SideSchema = z.enum(['LEFT', 'RIGHT']);

export const TriageOut = z.object({
  size: z.enum(['trivial', 'small', 'medium', 'large']),
  kind: z.string(),
  finders: z.array(z.string()),
  notes: z.string(),
});
export type TriageOut = z.infer<typeof TriageOut>;

const EvidenceSchema = z.object({
  path: z.string(),
  line: z.number().int().optional(),
  excerpt: z.string().optional(),
  note: z.string(),
});

// Findings as finders report them: no id/dimension (the runner assigns both).
export const FinderOut = z.array(
  z.object({
    path: z.string(),
    line: z.number().int(),
    side: SideSchema,
    startLine: z.number().int().optional(),
    claim: z.string(),
    consequence: z.string(),
    suggestion: z.string().optional(),
    severity: SeveritySchema,
    evidence: z.array(EvidenceSchema),
  }),
);
export type FinderOut = z.infer<typeof FinderOut>;

export const VerifyOut = z.object({
  verdict: z.preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['CONFIRMED', 'REFUTED', 'UNCERTAIN']),
  ),
  notes: z.string(),
});
export type VerifyOut = z.infer<typeof VerifyOut>;

export const VoiceOut = z.object({
  comments: z.array(
    z.object({
      findingId: z.string(),
      severity: SeveritySchema,
      body: z.string(),
    }),
  ),
  summary: z.string(),
  verdict: z.preprocess(
    (val) => (typeof val === 'string' ? val.toUpperCase() : val),
    z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']),
  ),
});
export type VoiceOut = z.infer<typeof VoiceOut>;

/**
 * Extracts the first JSON value from reply text: finds the first '{' or '['
 * and bracket-matches to its close, ignoring brackets inside JSON strings.
 * Tolerates ```json fences and surrounding prose (backticks are not
 * brackets, so scanning for the first bracket skips them).
 */
export function extractJson(text: string): string | undefined {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === '{' || ch === '[') {
      start = i;
      break;
    }
  }
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Prompts the agent for JSON matching `schema`, extracts and zod-parses the
 * first JSON value in the reply, retries once with the validation error
 * appended, then throws.
 */
export async function runJson<T>(
  invoker: AgentInvoker,
  opts: AgentRunOptions,
  schema: z.ZodType<T>,
  schemaName: string,
): Promise<T> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const instruction =
    `\n\nReply with ONLY a single JSON value matching this JSON schema (${schemaName}) - ` +
    `no prose before or after it:\n${jsonSchema}`;

  let prompt = opts.prompt + instruction;
  let lastError = '';
  let lastRawText = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await invoker.run({ ...opts, prompt });
    lastRawText = text;
    const raw = extractJson(text);
    if (raw === undefined) {
      lastError = 'no JSON value found in the reply';
    } else {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch (err) {
        lastError = `invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
        value = undefined;
      }
      if (value !== undefined) {
        const parsed = schema.safeParse(value);
        if (parsed.success) return parsed.data;
        lastError = parsed.error.message;
      }
    }
    prompt =
      opts.prompt +
      instruction +
      `\n\nYour previous reply was not valid ${schemaName} JSON: ${lastError}\n` +
      'Reply again with ONLY a JSON value matching the schema.';
  }
  elog('runJson', `${schemaName} validation failed after 2 attempts: ${lastError}\nRaw response: ${lastRawText.slice(0, 500)}`);
  throw new Error(`agent did not produce valid ${schemaName} JSON: ${lastError}`);
}
