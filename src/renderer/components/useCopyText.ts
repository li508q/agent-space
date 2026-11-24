import { useEffect, useRef, useState } from 'react';
import type { DesktopApi } from '../../contracts/app.js';
import type { ErrorCode } from '../../contracts/errors.js';

/** A copy receipt belongs to one visible binding and payload identity. */
export function useCopyText(
  api: Pick<DesktopApi, 'copyText'>,
  identity: string | null,
  enabled = true,
) {
  const scope = useRef({ identity, enabled, generation: 0 });
  if (scope.current.identity !== identity || scope.current.enabled !== enabled)
    scope.current = { identity, enabled, generation: scope.current.generation + 1 };
  const active = useRef(true),
    request = useRef(0);
  const [result, setResult] = useState<{
    generation: number;
    busy: boolean;
    copied: boolean;
    error: ErrorCode | null;
  } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current++;
    };
  }, []);
  const currentResult = result?.generation === scope.current.generation ? result : null;
  function fail(error: ErrorCode) {
    request.current++;
    setResult({ generation: scope.current.generation, busy: false, copied: false, error });
  }
  async function copy(text: string, stillCurrent: () => boolean = () => true) {
    if (!identity || !enabled || !stillCurrent()) return;
    const generation = scope.current.generation,
      ticket = ++request.current;
    setResult({ generation, busy: true, copied: false, error: null });
    const reply = await api.copyText({ text }).catch(() => null);
    if (!active.current || scope.current.generation !== generation || request.current !== ticket)
      return;
    if (!stillCurrent()) {
      setResult({ generation, busy: false, copied: false, error: null });
      return;
    }
    setResult({
      generation,
      busy: false,
      copied: reply?.ok === true,
      error: reply?.ok ? null : reply && !reply.ok ? reply.error.code : 'OPERATION_UNKNOWN',
    });
  }
  return {
    copy,
    fail,
    busy: currentResult?.busy ?? false,
    copied: currentResult?.copied ?? false,
    error: currentResult?.error ?? null,
  };
}
