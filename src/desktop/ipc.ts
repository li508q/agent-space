import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import {
  HumanReadSchema,
  HumanSaveSchema,
  IdSchema,
  QuerySchema,
  ReviewSchema,
  UndoSchema,
} from '../contracts/schema.js';
import {
  CreateObjectSchema,
  CreateGrantSchema,
  UpdateGrantSchema,
  DraftListSchema,
  SaveDraftSchema,
  DiscardDraftSchema,
  HistorySchema,
  KnowledgeReviewSchema,
  MarkSeenSchema,
  OperationStatusSchema,
  PageRequestSchema,
  ProposalListSchema,
  SetPolicySchema,
  type HumanServices,
} from '../contracts/core.js';
import type { BoundRequest } from '../contracts/desktop.js';
import type { ObjectContent } from '../contracts/schema.js';
import type { Result } from '../contracts/errors.js';
import {
  SchemaDescribeSchema,
  TextSearchSchema,
  RelationsExpandSchema,
  AcceptedChangeReadSchema,
} from '../contracts/context.js';
import { Workspace } from './workspace.js';
import { input, bound } from './validation.js';
import { trustedSender } from './security.js';
import { channel, mutatingMethods } from './channels.js';

export function registerCoreHandlers(
  owner: WebContents,
  workspace: Workspace,
  remember: (content: ObjectContent) => void,
): () => void {
  const registered: string[] = [];
  const add = <S extends z.ZodType, T>(
    name: keyof HumanServices,
    schema: S,
    action: (h: HumanServices, p: z.output<S>) => Result<T>,
  ) => {
    const ipc = channel(name);
    registered.push(ipc);
    ipcMain.handle(ipc, (event, raw: unknown) => {
      if (!trustedSender(event, owner))
        return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
      const checked = input(bound(schema), raw);
      if (!checked.ok) return checked;
      const request = checked.value as unknown as BoundRequest<z.output<S>>;
      const active = workspace.validate(request);
      if (!active.ok) return active;
      try {
        if (['createObject', 'saveObject', 'saveDraft'].includes(name)) {
          const data = request.input as { content: ObjectContent };
          remember(data.content);
        }
        const result = action(active.value, request.input);
        if (name === 'readObject' && result.ok)
          remember((result.value as { object: { content: ObjectContent } }).object.content);
        return result;
      } catch {
        return {
          ok: false,
          error: {
            code: mutatingMethods.has(name) ? 'OPERATION_UNKNOWN' : 'STORAGE_FAILURE',
            retryable: mutatingMethods.has(name),
          },
        };
      }
    });
  };
  add('status', z.null(), (h) => h.status());
  add('createObject', CreateObjectSchema, (h, p) => h.createObject(p));
  add('saveObject', HumanSaveSchema, (h, p) => h.saveObject(p));
  add('readObject', HumanReadSchema, (h, p) => h.readObject(p));
  add('query', QuerySchema, (h, p) => h.query(p));
  add('describe', SchemaDescribeSchema, (h, p) => h.describe(p));
  add('search', TextSearchSchema, (h, p) => h.search(p));
  add('expandRelations', RelationsExpandSchema, (h, p) => h.expandRelations(p));
  add('readAcceptedChange', AcceptedChangeReadSchema, (h, p) => h.readAcceptedChange(p));
  add('history', HistorySchema, (h, p) => h.history(p));
  add('saveDraft', SaveDraftSchema, (h, p) => h.saveDraft(p));
  add('listDrafts', DraftListSchema, (h, p) => h.listDrafts(p));
  add('readDraft', z.strictObject({ draftId: IdSchema }), (h, p) => h.readDraft(p));
  add('discardDraft', DiscardDraftSchema, (h, p) => h.discardDraft(p));
  add('getProposal', z.strictObject({ proposalId: IdSchema }), (h, p) => h.getProposal(p));
  add('listProposals', ProposalListSchema, (h, p) => h.listProposals(p));
  add('markProposalSeen', MarkSeenSchema, (h, p) => h.markProposalSeen(p));
  add('reviewProposal', ReviewSchema, (h, p) => h.reviewProposal(p));
  add('undoChange', UndoSchema, (h, p) => h.undoChange(p));
  add('createGrant', CreateGrantSchema, (h, p) => h.createGrant(p));
  add('updateGrant', UpdateGrantSchema, (h, p) => h.updateGrant(p));
  add('listGrants', z.null(), (h) => h.listGrants());
  add('setPolicy', SetPolicySchema, (h, p) => h.setPolicy(p));
  add('markKnowledgeReviewed', KnowledgeReviewSchema, (h, p) => h.markKnowledgeReviewed(p));
  add('changes', PageRequestSchema, (h, p) => h.changes(p));
  add('activity', PageRequestSchema, (h, p) => h.activity(p));
  add('operationStatus', OperationStatusSchema, (h, p) => h.operationStatus(p));
  return () => registered.forEach((name) => ipcMain.removeHandler(name));
}
