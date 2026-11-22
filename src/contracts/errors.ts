// Stable machine codes map to localized UI messages; never parse an English exception.
// Scope is rechecked before disclosing target-specific diagnostic details.
export const errorCodes = [
  'INVALID_INPUT',
  'FORBIDDEN',
  'NOT_FOUND',
  'STALE_REVISION',
  'PROTECTED_FIELD',
  'OBJECT_ID_RESERVED',
  'OPERATION_UNKNOWN',
  'PROPOSAL_CHANGED',
  'PROPOSAL_RESOLVED',
  'IDEMPOTENCY_KEY_REUSED',
  'CURSOR_STALE',
  'INVALID_CURSOR',
  'LIMIT_EXCEEDED',
  'SCHEMA_UNSUPPORTED',
  'SPACE_MISMATCH',
  'STORAGE_BUSY',
  'STORAGE_FAILURE',
  'INTEGRITY_FAILURE',
  'SOURCE_UNAVAILABLE',
  'UNSAFE_LINK',
  'UNSUPPORTED_IMPORT',
  'IMPORT_SOURCE_CHANGED',
  'IMPORT_PLAN_CHANGED',
  'DESTINATION_EXISTS',
  'UNDO_NOT_SUPPORTED',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export type ErrorMessageKey = `error.${ErrorCode}`;
export type LocaleErrorDictionary = Record<ErrorMessageKey, string>;
export type Failure = {
  ok: false;
  error: {
    code: ErrorCode;
    retryable: boolean;
    field?: string;
    params?: Record<string, string | number>;
  };
};
export type Result<T> = { ok: true; value: T } | Failure;
