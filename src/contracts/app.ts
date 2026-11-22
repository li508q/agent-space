import { z } from 'zod';
import { IdSchema, LocaleSchema } from './schema.js';
import type { Locale } from './schema.js';
import type { SpaceStatus } from './core.js';
import type { Failure, Result } from './errors.js';
import type { BoundRequest, DesktopCoreBridge } from './desktop.js';

// Native dialogs select all filesystem locations. Paths are display data or
// generated launch configuration, never arbitrary renderer file operations.
export const CreateSpaceDialogSchema = z.strictObject({ title: z.string().min(1).max(160) });
export const LocalePreferenceSchema = z.strictObject({ locale: LocaleSchema });
export const TextScaleSchema = z.strictObject({
  factor: z.union([z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(2)]),
});
export const CopyTextSchema = z.strictObject({ text: z.string().max(2_097_152) });
export const OpenExternalSchema = z.strictObject({ url: z.string().min(1).max(4_096) });
export const AgentConfigurationSchema = z.strictObject({
  grantId: IdSchema,
  token: z.string().min(1).max(128),
});
export const CloseResponseSchema = z.strictObject({
  requestId: IdSchema,
  decision: z.enum(['ready', 'cancel', 'discard']),
});

export type AppPreferences = { locale: Locale | null; textScale: 1 | 1.25 | 1.5 | 2 };
export type SpaceSession = {
  bindingId: string;
  status: SpaceStatus;
  locationLabel: string;
};
export type AppBootstrap = {
  version: string;
  preferences: AppPreferences;
  systemLocales: string[];
  activeSpace: SpaceSession | null;
  startupError: Failure['error'] | null;
};
export type AgentLaunchConfiguration = {
  command: string;
  args: string[];
  env: Record<string, string>;
  codexToml: string;
  stdioJson: string;
  development: boolean;
};
export type MenuCommand = 'new-note' | 'search' | 'save' | 'settings';
export type CloseRequest = { requestId: string };
export type Unsubscribe = () => void;

/** Trusted desktop UI only. The MCP adapter never receives this interface. */
export interface DesktopApi extends DesktopCoreBridge {
  bootstrap(): Promise<Result<AppBootstrap>>;
  createSpace(
    request: z.infer<typeof CreateSpaceDialogSchema>,
  ): Promise<Result<SpaceSession | null>>;
  openSpace(): Promise<Result<SpaceSession | null>>;
  openExample(): Promise<Result<SpaceSession>>;
  setLocale(request: z.infer<typeof LocalePreferenceSchema>): Promise<Result<AppPreferences>>;
  setTextScale(request: z.infer<typeof TextScaleSchema>): Promise<Result<AppPreferences>>;
  copyText(request: z.infer<typeof CopyTextSchema>): Promise<Result<{ copied: true }>>;
  openExternal(request: z.infer<typeof OpenExternalSchema>): Promise<Result<{ opened: true }>>;
  agentConfiguration(
    request: BoundRequest<z.infer<typeof AgentConfigurationSchema>>,
  ): Promise<Result<AgentLaunchConfiguration>>;
  onMenuCommand(listener: (command: MenuCommand) => void): Unsubscribe;
  onCloseRequested(listener: (request: CloseRequest) => void): Unsubscribe;
  respondToClose(
    request: z.infer<typeof CloseResponseSchema>,
  ): Promise<Result<{ closed: boolean }>>;
}

declare global {
  interface Window {
    agentSpace: DesktopApi;
  }
}
