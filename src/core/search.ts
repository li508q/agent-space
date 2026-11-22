import type { ObjectContent } from '../contracts/schema.js';
import { normalize } from './support.js';

/** Projection order is stable before and after canonical SQLite JSON storage. */
export function searchProjection(content: ObjectContent): string {
  return normalize(
    content.title +
      '\n' +
      content.body +
      '\n' +
      Object.keys(content.properties)
        .sort()
        .map((key) => {
          const field = content.properties[key]!;
          return field.label + ' ' + String(field.value ?? '');
        })
        .join('\n'),
  );
}
