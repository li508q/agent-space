import type { HumanServices } from './core.js';

// Active-space requests only. Native dialogs and app preferences use DesktopApi;
// no raw invoke/path/SQL/process method is exposed.
// A fresh binding ID on every successful space switch rejects old A→B→A
// callbacks. Object/editor generations protect the visible input buffer.
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
  describe: AsyncBound<'describe'>;
  search: AsyncBound<'search'>;
  expandRelations: AsyncBound<'expandRelations'>;
  readAcceptedChange: AsyncBound<'readAcceptedChange'>;
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
  setLifecycle: AsyncBound<'setLifecycle'>;
  retryImport: AsyncBound<'retryImport'>;
  pauseImport: AsyncBound<'pauseImport'>;
  getImport: AsyncBound<'getImport'>;
  listImports: AsyncBound<'listImports'>;
  listRecoverableDrafts: AsyncBound<'listRecoverableDrafts'>;
  readRecoverableDraft: AsyncBound<'readRecoverableDraft'>;
  copyRecoverableDraft: AsyncBound<'copyRecoverableDraft'>;
}
