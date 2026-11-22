import { z } from 'zod';
import type { AgentServices } from '../contracts/core.js';
import { OperationStatusSchema, PageRequestSchema } from '../contracts/core.js';
import type { ErrorCode, Failure, Result } from '../contracts/errors.js';
import {
  AgentToolSchema,
  ProposeSchema,
  QuerySchema,
  ReadSchema,
  type AgentTool,
} from '../contracts/schema.js';

// discover() has no arguments. Derive a strict empty shape from the shared
// strict request schema rather than accepting arbitrary discovery parameters.
const NoArgumentsSchema = OperationStatusSchema.pick({});

export const toolDefinitions = {
  space_discover: {
    schema: NoArgumentsSchema,
    description:
      'Discover this configured space, visible kinds, grant capabilities and limits. No document bodies are returned.',
  },
  objects_query: {
    schema: QuerySchema,
    description:
      'Query authorized current objects with kind/project/property and literal text filters. Follow nextCursor; restart on CURSOR_STALE. Search does not prove semantic completeness.',
  },
  object_read: {
    schema: ReadSchema,
    description:
      'Read an explicit summary/body/properties/relations section within maxBytes. Continue with nextCursor to retain the same pinned revision. Ranges count Unicode code points or entries.',
  },
  proposal_create: {
    schema: ProposeSchema,
    description:
      'Persist one reviewable update or new-note/record candidate, never an accepted edit. Include purpose, reason, sources and a stable operationKey. Reuse the same key/request after an uncertain result.',
  },
  changes_list: {
    schema: PageRequestSchema,
    description:
      'List authorized durable change summaries using an after/through watermark. A proposed change is not an applied body. Follow nextAfter while truncated.',
  },
  operation_status: {
    schema: OperationStatusSchema,
    description:
      'Look up an operationKey in this grant namespace. Original receipt.business and currentProposal are separate. not_found is not a failure confirmation; retain the original key.',
  },
} satisfies Record<AgentTool, { schema: z.ZodType; description: string }>;

export function failure(code: ErrorCode, retryable = false, field?: string): Failure {
  return { ok: false, error: { code, retryable, ...(field ? { field } : {}) } };
}

function checked<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  invoke: (input: z.infer<S>) => Result<T>,
): Result<T> {
  const parsed = schema.safeParse(input);
  // Do not echo input, tokens, authored strings or Zod's exception text.
  if (!parsed.success) return failure('INVALID_INPUT', false, 'arguments');
  return invoke(parsed.data);
}

/** The only dispatch surface shared by MCP and the single-call CLI. */
export function invokeAgentTool(
  agent: AgentServices,
  name: unknown,
  input: unknown,
): Result<unknown> {
  const tool = AgentToolSchema.safeParse(name);
  if (!tool.success) return failure('INVALID_INPUT', false, 'tool');
  switch (tool.data) {
    case 'space_discover':
      return checked(NoArgumentsSchema, input, () => agent.discover());
    case 'objects_query':
      return checked(QuerySchema, input, (request) => agent.query(request));
    case 'object_read':
      return checked(ReadSchema, input, (request) => agent.read(request));
    case 'proposal_create':
      return checked(ProposeSchema, input, (request) => agent.propose(request));
    case 'changes_list':
      return checked(PageRequestSchema, input, (request) => agent.changes(request));
    case 'operation_status':
      return checked(OperationStatusSchema, input, (request) => agent.operationStatus(request));
  }
}

export const MAX_AGENT_INPUT_BYTES = 2_097_152;
