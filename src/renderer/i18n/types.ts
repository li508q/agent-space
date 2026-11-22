import type { en } from './en.js';

export const supportedLocales = ['en', 'zh-CN', 'ja', 'ko', 'es'] as const;
export type Locale = (typeof supportedLocales)[number];
export type MessageKey = keyof typeof en;
export type Dictionary = { readonly [K in MessageKey]: string };

type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

export type InterpolationValue = string | number;
export type TranslationArgs<K extends MessageKey> = [Placeholders<(typeof en)[K]>] extends [never]
  ? []
  : [params: Record<Placeholders<(typeof en)[K]>, InterpolationValue>];

export const countUnits = ['items', 'pendingProposals', 'changes', 'sources', 'files'] as const;
export type CountUnit = (typeof countUnits)[number];
export type CountMessageKey = `count.${CountUnit}.${'one' | 'other'}`;
export type TitleKind = 'document' | 'project' | 'record' | 'asset';

export const localeNames = Object.freeze({
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
} as const satisfies Record<Locale, string>);
