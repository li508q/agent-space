import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { IdSchema } from '../contracts/schema.js';
import type { AgentServices, HumanServices, SpaceStatus } from '../contracts/core.js';
import type { Result } from '../contracts/errors.js';
import { Store } from './storage.js';
import { Engine, type Context } from './engine.js';
import { parse, safe } from './support.js';

const createOptions = z.strictObject({
  title: z.string().min(1).max(160),
  example: z.boolean().optional(),
});
const directorySchema = z.string().min(1).max(4_096).refine(isAbsolute);
const agentOptions = z.strictObject({
  grantId: IdSchema,
  token: z.string().min(1).max(128),
  instanceId: IdSchema,
});

/** Trusted adapters own factories and human context. Never expose them as agent tools. */
export class Space {
  #engine: Engine;
  #store: Store;
  private constructor(store: Store) {
    this.#store = store;
    this.#engine = new Engine(store);
  }
  static create(directory: string, options: { title: string; example?: boolean }): Result<Space> {
    return safe(() => {
      const p = parse(createOptions, options);
      return new Space(
        Store.create(parse(directorySchema, directory), {
          title: p.title,
          example: p.example ?? false,
        }),
      );
    });
  }
  static open(directory: string): Result<Space> {
    return safe(() => new Space(Store.open(parse(directorySchema, directory))));
  }
  /** Installation namespace is stable across reopen; never derived from an editor session/PID. */
  human(namespace: string): HumanServices {
    return new HumanFacade(this.#engine, { kind: 'human', namespace });
  }
  agent(options: { grantId: string; token: string; instanceId: string }): Result<AgentServices> {
    const parsed = safe(() => parse(agentOptions, options));
    if (!parsed.ok) return parsed;
    const context: Context = { kind: 'agent', ...parsed.value };
    const checked = this.#engine.authenticate(context);
    return checked.ok ? { ok: true, value: new AgentFacade(this.#engine, context) } : checked;
  }
  close(): void {
    this.#store.close();
  }
}

class HumanFacade implements HumanServices {
  #core: Engine;
  #context: Context;
  constructor(core: Engine, context: Context) {
    this.#core = core;
    this.#context = context;
  }
  status(): Result<SpaceStatus> {
    return this.#core.status(this.#context);
  }
  createObject(input: unknown) {
    return this.#core.createObject(this.#context, input);
  }
  saveObject(input: unknown) {
    return this.#core.saveObject(this.#context, input);
  }
  readObject(input: unknown) {
    return this.#core.readObject(this.#context, input);
  }
  query(input: unknown) {
    return this.#core.query(this.#context, input);
  }
  describe(input: unknown) {
    return this.#core.describe(this.#context, input);
  }
  search(input: unknown) {
    return this.#core.search(this.#context, input);
  }
  expandRelations(input: unknown) {
    return this.#core.expandRelations(this.#context, input);
  }
  readAcceptedChange(input: unknown) {
    return this.#core.readAcceptedChange(this.#context, input);
  }
  history(input: unknown) {
    return this.#core.history(this.#context, input);
  }
  setPolicy(input: unknown) {
    return this.#core.setPolicy(this.#context, input);
  }
  markKnowledgeReviewed(input: unknown) {
    return this.#core.markKnowledgeReviewed(this.#context, input);
  }
  createGrant(input: unknown) {
    return this.#core.createGrant(this.#context, input);
  }
  updateGrant(input: unknown) {
    return this.#core.updateGrant(this.#context, input);
  }
  listGrants() {
    return this.#core.listGrants(this.#context);
  }
  getProposal(input: unknown) {
    return this.#core.getProposal(this.#context, input);
  }
  listProposals(input: unknown) {
    return this.#core.listProposals(this.#context, input);
  }
  markProposalSeen(input: unknown) {
    return this.#core.markProposalSeen(this.#context, input);
  }
  reviewProposal(input: unknown) {
    return this.#core.reviewProposal(this.#context, input);
  }
  undoChange(input: unknown) {
    return this.#core.undoChange(this.#context, input);
  }
  saveDraft(input: unknown) {
    return this.#core.saveDraft(this.#context, input);
  }
  listDrafts(input: unknown) {
    return this.#core.listDrafts(this.#context, input);
  }
  readDraft(input: unknown) {
    return this.#core.readDraft(this.#context, input);
  }
  discardDraft(input: unknown) {
    return this.#core.discardDraft(this.#context, input);
  }
  changes(input: unknown) {
    return this.#core.changes(this.#context, input);
  }
  activity(input: unknown) {
    return this.#core.activities(this.#context, input);
  }
  operationStatus(input: unknown) {
    return this.#core.operationStatus(this.#context, input);
  }
}
class AgentFacade implements AgentServices {
  #core: Engine;
  #context: Context;
  constructor(core: Engine, context: Context) {
    this.#core = core;
    this.#context = context;
  }
  discover() {
    return this.#core.discover(this.#context);
  }
  query(input: unknown) {
    return this.#core.query(this.#context, input);
  }
  describe(input: unknown) {
    return this.#core.describe(this.#context, input);
  }
  search(input: unknown) {
    return this.#core.search(this.#context, input);
  }
  expandRelations(input: unknown) {
    return this.#core.expandRelations(this.#context, input);
  }
  readAcceptedChange(input: unknown) {
    return this.#core.readAcceptedChange(this.#context, input);
  }
  read(input: unknown) {
    return this.#core.readFragment(this.#context, input);
  }
  propose(input: unknown) {
    return this.#core.propose(this.#context, input);
  }
  changes(input: unknown) {
    return this.#core.changes(this.#context, input);
  }
  operationStatus(input: unknown) {
    return this.#core.operationStatus(this.#context, input);
  }
}

/** Synthetic persisted material, no fabricated agent connection or operation. */
export function createExampleSpace(directory: string): Result<Space> {
  const result = Space.create(directory, { title: 'Example space', example: true });
  if (!result.ok) return result;
  const human = result.value.human('example-setup');
  const content = {
    title: 'Working notes',
    body: '# Working notes\n\nThis is a separate example space. Write directly, inspect history, or connect a real external agent to propose a change.\n',
    properties: {},
    relations: [],
  };
  const seeded = human.createObject({
    operationKey: 'example:working-notes',
    kind: 'document',
    content,
  });
  if (!seeded.ok) {
    result.value.close();
    return seeded;
  }
  return result;
}
