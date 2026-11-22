import { realpathSync, readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { IpcMainInvokeEvent, WebContents } from 'electron';

export const APP_SCHEME = 'agentspace';
export const APP_HOST = 'app';
export const APP_URL = 'agentspace://app/index.html';
// CodeMirror style-mod and React style attributes need inline styles. Scripts remain strict.
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'";
export function isAppDocument(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === APP_SCHEME + ':' &&
      u.hostname === APP_HOST &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.pathname === '/index.html' &&
      !u.search
    );
  } catch {
    return false;
  }
}
export function trustedSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  owner: WebContents,
): boolean {
  return (
    event.sender === owner &&
    !owner.isDestroyed() &&
    event.senderFrame === owner.mainFrame &&
    isAppDocument(event.senderFrame?.url ?? '')
  );
}
export function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      !u.hostname ||
      u.username ||
      u.password ||
      /[\r\n]/.test(raw)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
const mime: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff: 'font/woff',
  woff2: 'font/woff2',
};
/** Only a startup manifest of compiled renderer assets is addressable. No parent or source files. */
export class RendererAssets {
  #manifest = new Map<string, { path: string; mime: string }>();
  readonly root: string;
  constructor(directory: string) {
    this.root = realpathSync(directory);
    const visit = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const file = join(directory, name);
        const info = lstatSync(file);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) visit(file);
        else {
          const extension = name.split('.').at(-1)!;
          if (mime[extension])
            this.#manifest.set('/' + relative(this.root, file).split(sep).join('/'), {
              path: file,
              mime: mime[extension],
            });
        }
      }
    };
    visit(this.root);
    if (!this.#manifest.has('/index.html')) throw new Error('Renderer entry unavailable');
  }
  async respond(request: { url: string; method: string }): Promise<Response> {
    const headers = {
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    };
    try {
      const u = new URL(request.url);
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        u.protocol !== APP_SCHEME + ':' ||
        u.hostname !== APP_HOST ||
        u.port ||
        u.username ||
        u.password ||
        u.search
      )
        return new Response(null, { status: 403, headers });
      const decoded = decodeURIComponent(u.pathname);
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded.includes('%') ||
        decoded.split('/').some((p) => p === '..' || p === '.')
      )
        return new Response(null, { status: 403, headers });
      const asset = this.#manifest.get(decoded);
      if (!asset || !realpathSync(asset.path).startsWith(this.root + sep))
        return new Response(null, { status: 404, headers });
      return new Response(
        request.method === 'HEAD' ? null : new Uint8Array(readFileSync(asset.path)),
        { headers: { ...headers, 'Content-Type': asset.mime } },
      );
    } catch {
      return new Response(null, { status: 404, headers });
    }
  }
}
