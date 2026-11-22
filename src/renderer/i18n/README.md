# Renderer language foundation

Five complete flat dictionaries share the English key/placeholder contract. Product messages are
plain text. No React, bridge DTO, provider, storage, or network dependency is introduced here.

```ts
import { t, formatCount, formatDate, formatDateTime, getErrorCopy, titleText } from './index.js';

t('ja', 'proposal.originalChanged');
t('es', 'editor.savedAt', { time: '14:32' });
formatCount('en', 'pendingProposals', 2);
formatDate('ko', '2026-11-23'); // calendar date, without a timezone shift
formatDateTime('zh-CN', '2026-11-22T17:30:00Z', 'Asia/Shanghai');
getErrorCopy('en', 'STALE_REVISION'); // stable code, never a raw exception message
titleText('es', ''); // display placeholder only; never write it into the title
```

Missing/unknown keys, unsupported explicit locales, mismatched interpolation, malformed dictionaries,
and unknown error codes throw `I18nError`. There is no per-message English fallback. Only
`resolveSystemLocale` applies the documented startup language preference/fallback.

Interpolation inserts authored values once and does not translate, trim, or normalize them.
Render returned strings and authored content through text nodes, never `innerHTML`.
Locale changes must preserve editor/selection state; this module does not manage that state.
The renderer must keep user labels, source titles, body text, and agent reasons separate from message keys.

`getErrorCopy` returns a localized message plus a details action label. The consumer decides which
authorized human-readable diagnostics to show; it must not insert raw SQLite/IPC exception text
into the primary message.

Agent activity records Core preparation only. The existing `agent.delivered` and
`agent.deliveryNotice` keys label material prepared for return, not transport delivery or client
receipt. Numeric activity IDs identify stable preparation records. They do not prove that a host
received the result, a model understood it, or a task finished.

Import `../styles/base.css` once and set the document's `lang` to the selected locale. CSS provides
offline fonts, tokens, focus, wrapping, and reduced-motion behavior, not pane routing or dialog semantics.
The SVG mark is local vector artwork; hide it from assistive technology when adjacent text already names the app.

Reference behavior: [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat),
[Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules),
and [reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

Run `npx tsx --test tests/ui/i18n.test.ts`. This checks the foundation, not full UI translation,
native IME behavior, focus restoration, text zoom, or five-locale layout. Those checks remain pending.
