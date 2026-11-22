import { TypedFieldSchema } from '../../contracts/schema.js';
import type { ObjectContent, ObjectRef } from '../../contracts/schema.js';
import type { Kind } from '../../contracts/core.js';

export type Field = ObjectContent['properties'][string];
export type FieldType = Field['type'];
export type Relation = ObjectContent['relations'][number];
export type Predicate = Relation['predicate'];
export type FieldInput = {
  key: string;
  label: string;
  type: FieldType;
  unset: boolean;
  text: string;
  options: string[];
};
export type FieldProblem = 'label' | 'number' | 'date' | 'select' | 'options' | 'limit';

export function newField(type: FieldType = 'text', id: string = crypto.randomUUID()): FieldInput {
  return {
    key: `f_${id.replaceAll('-', '')}`,
    label: '',
    type,
    unset: true,
    text: '',
    options: type === 'select' ? [''] : [],
  };
}
export function fieldInputs(properties: ObjectContent['properties']): FieldInput[] {
  return Object.entries(properties).map(([key, field]) => ({
    key,
    label: field.label,
    type: field.type,
    unset: field.value === null,
    text: field.value === null ? '' : String(field.value),
    options: field.type === 'select' ? [...field.options] : [],
  }));
}
export function parseField(
  input: FieldInput,
  decimalSeparator = '.',
): { ok: true; field: Field } | { ok: false; problem: FieldProblem } {
  if (!input.label || input.label.length > 120) return { ok: false, problem: 'label' };
  let value: string | number | boolean | null = input.unset ? null : input.text;
  if (input.type === 'number' && !input.unset) {
    const text = (decimalSeparator === ',' ? input.text.replace(',', '.') : input.text).trim();
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ||
      !Number.isFinite(Number(text))
    )
      return { ok: false, problem: 'number' };
    value = Number(text);
  }
  if (input.type === 'boolean' && !input.unset) {
    if (input.text !== 'true' && input.text !== 'false') return { ok: false, problem: 'select' };
    value = input.text === 'true';
  }
  if (input.type === 'select') {
    if (
      input.options.length < 1 ||
      input.options.length > 50 ||
      input.options.some((option) => option.length < 1 || option.length > 100)
    )
      return { ok: false, problem: 'options' };
    if (!input.unset && !input.options.includes(input.text))
      return { ok: false, problem: 'select' };
  }
  const candidate = {
    label: input.label,
    type: input.type,
    value,
    ...(input.type === 'select' ? { options: [...input.options] } : {}),
  };
  const result = TypedFieldSchema.safeParse(candidate);
  if (!result.success) return { ok: false, problem: input.type === 'date' ? 'date' : 'limit' };
  return { ok: true, field: result.data };
}
export function parseFields(
  inputs: FieldInput[],
  decimalSeparator = '.',
):
  | { ok: true; properties: ObjectContent['properties'] }
  | { ok: false; problems: Record<string, FieldProblem> } {
  const properties: ObjectContent['properties'] = {},
    problems: Record<string, FieldProblem> = {};
  for (const input of inputs) {
    const result = parseField(input, decimalSeparator);
    if (result.ok) properties[input.key] = result.field;
    else problems[input.key] = result.problem;
  }
  if (inputs.length > 64) problems[inputs.at(-1)!.key] = 'limit';
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, properties };
}

/** Reuse definitions and their identity, never values, body, title or project membership. */
export function recordFromFields(properties: ObjectContent['properties']): ObjectContent {
  return {
    title: '',
    body: '',
    relations: [],
    properties: Object.fromEntries(
      Object.entries(properties).map(([key, field]) => [
        key,
        { ...structuredClone(field), value: null },
      ]),
    ),
  };
}

export const relationLabels = {
  belongs_to: 'relation.inProject',
  related: 'relation.related',
  source: 'relation.source',
  uses: 'relation.usesAsset',
  continues_from: 'project.continuation',
} as const;
export function relationTargetKind(predicate: Predicate): Kind | undefined {
  return predicate === 'belongs_to' ? 'project' : predicate === 'uses' ? 'asset' : undefined;
}
export function makeRelation(
  predicate: Predicate,
  target: { id: string; kind: Kind; revision: number },
  pinned: boolean,
  id: string = crypto.randomUUID(),
): Relation {
  const requiredKind = relationTargetKind(predicate);
  if (requiredKind && target.kind !== requiredKind)
    throw new Error('Wrong relationship target kind');
  if (!Number.isSafeInteger(target.revision) || target.revision < 1)
    throw new Error('Invalid revision');
  const current = { mode: 'current' as const, objectId: target.id };
  if (predicate === 'belongs_to' || predicate === 'related')
    return { id, predicate, target: current };
  const reference: ObjectRef =
    predicate === 'source' || pinned
      ? { mode: 'pinned', objectId: target.id, revision: target.revision }
      : current;
  if (predicate === 'source')
    return {
      id,
      predicate,
      target: { mode: 'pinned', objectId: target.id, revision: target.revision },
    };
  return { id, predicate, target: reference };
}
