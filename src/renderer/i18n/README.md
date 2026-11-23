# Product localization

English, Simplified Chinese, Japanese, Korean and Spanish use flat dictionaries with identical keys and placeholders. Messages are plain text. This module has no UI, storage, bridge or network dependency.

```ts
import { t, formatCount, formatDate, formatDateTime, getErrorCopy, titleText } from './index.js';

t('ja', 'proposal.originalChanged');
t('es', 'editor.savedAt', { time: '14:32' });
formatCount('en', 'pendingProposals', 2);
formatDate('ko', '2026-01-15');
formatDateTime('zh-CN', '2026-01-15T09:30:00Z', 'Asia/Shanghai');
getErrorCopy('en', 'STALE_REVISION');
titleText('es', '');
```

## Contracts

- Missing keys, unsupported explicit locales, mismatched placeholders, malformed dictionaries and unknown error codes throw `I18nError`. There is no per-message English fallback. `resolveSystemLocale` handles startup language selection.
- Insert authored values once. Do not translate, trim or normalize titles, labels, content or agent reasons. Render text nodes, never `innerHTML`.
- Format calendar dates without shifting their day. Instants require an explicit timezone and an offset-bearing timestamp.
- `titleText` supplies a display placeholder; never save it into authored content.
- `getErrorCopy` accepts stable contract codes. Show only authorized diagnostics; do not expose raw database or IPC exceptions.
- `activity.prepared` and `agent.deliveryNotice` describe prepared references. They do not assert host receipt, model understanding or completed work.

## Integration

Set the document's `lang` and import `../styles/base.css` once. Preserve editor identity, input and selection when locale changes. Keep full conflict and recovery messages readable; do not abbreviate them to fit a badge.

Run `npx tsx --test tests/ui/i18n.test.ts` for dictionary, interpolation and formatting contracts. Use the native suites in [Testing](../../../docs/TESTING.md) for layout, focus and composition coverage.
