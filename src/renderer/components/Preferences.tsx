import type { AppPreferences } from '../../contracts/app.js';
import { localeNames, supportedLocales, t, type Locale } from '../i18n/index.js';
import { useLocale } from '../ui.js';

export function Preferences({
  scale,
  busy,
  onLocale,
  onScale,
}: {
  scale: AppPreferences['textScale'];
  busy: boolean;
  onLocale: (locale: Locale) => void;
  onScale: (factor: AppPreferences['textScale']) => void;
}) {
  const locale = useLocale();
  return (
    <div className="preferences">
      <label>
        {t(locale, 'settings.language')}
        <select
          value={locale}
          disabled={busy}
          onChange={(event) => onLocale(event.target.value as Locale)}
          data-testid="locale-select"
        >
          {supportedLocales.map((value) => (
            <option key={value} value={value}>
              {localeNames[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t(locale, 'settings.textSize')}
        <select
          value={scale}
          disabled={busy}
          onChange={(event) => onScale(Number(event.target.value) as AppPreferences['textScale'])}
          data-testid="text-scale-select"
        >
          {([1, 1.25, 1.5, 2] as const).map((factor) => (
            <option key={factor} value={factor}>
              {factor * 100}%
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
