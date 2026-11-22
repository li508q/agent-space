import type { HumanServices } from './core.js';

// An active-space bridge only. Platform create/open dialogs and app preferences
// belong to the later desktop adapter. No raw invoke/path/SQL/process method.
// A fresh binding ID on every successful space switch also rejects old A→B→A
// callbacks. Object/editor generations still protect the visible input buffer.
export type BoundRequest<T> = {
  bindingId: string;
  spaceId: string;
  instanceId: string;
  input: T;
};
type AsyncBound<K extends keyof HumanServices> = HumanServices[K] extends (
  ...args: infer A
) => infer R
  ? (request: BoundRequest<A extends [] ? null : A[0]>) => Promise<R>
  : never;
export interface DesktopCoreBridge {
  status: AsyncBound<'status'>;
  createObject: AsyncBound<'createObject'>;
  saveObject: AsyncBound<'saveObject'>;
  readObject: AsyncBound<'readObject'>;
  query: AsyncBound<'query'>;
  history: AsyncBound<'history'>;
  saveDraft: AsyncBound<'saveDraft'>;
  listDrafts: AsyncBound<'listDrafts'>;
  readDraft: AsyncBound<'readDraft'>;
  discardDraft: AsyncBound<'discardDraft'>;
  getProposal: AsyncBound<'getProposal'>;
  listProposals: AsyncBound<'listProposals'>;
  markProposalSeen: AsyncBound<'markProposalSeen'>;
  reviewProposal: AsyncBound<'reviewProposal'>;
  undoChange: AsyncBound<'undoChange'>;
  createGrant: AsyncBound<'createGrant'>;
  updateGrant: AsyncBound<'updateGrant'>;
  listGrants: AsyncBound<'listGrants'>;
  setPolicy: AsyncBound<'setPolicy'>;
  markKnowledgeReviewed: AsyncBound<'markKnowledgeReviewed'>;
  changes: AsyncBound<'changes'>;
  activity: AsyncBound<'activity'>;
  operationStatus: AsyncBound<'operationStatus'>;
}
