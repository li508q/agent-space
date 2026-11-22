import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { Space, createExampleSpace } from '../core/index.js';
import { IdSchema } from '../contracts/schema.js';
import type { HumanServices } from '../contracts/core.js';
import type { BoundRequest } from '../contracts/desktop.js';
import type { SpaceSession } from '../contracts/app.js';
import type { Result } from '../contracts/errors.js';
import { Preferences } from './preferences.js';

const BindingSchema = z.strictObject({
  bindingId: IdSchema,
  spaceId: IdSchema,
  instanceId: IdSchema,
  input: z.unknown(),
});
export class Workspace {
  #active: { space: Space; human: HumanServices; directory: string; session: SpaceSession } | null =
    null;
  constructor(readonly preferences: Preferences) {}
  get session(): SpaceSession | null {
    return this.#active?.session ?? null;
  }
  get directory(): string | null {
    return this.#active?.directory ?? null;
  }
  get human(): HumanServices | null {
    return this.#active?.human ?? null;
  }
  validate<T>(request: BoundRequest<T>): Result<HumanServices> {
    const parsed = BindingSchema.safeParse(request);
    if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', retryable: false } };
    const active = this.#active;
    if (
      !active ||
      parsed.data.bindingId !== active.session.bindingId ||
      parsed.data.spaceId !== active.session.status.spaceId ||
      parsed.data.instanceId !== active.session.status.instanceId
    )
      return { ok: false, error: { code: 'SPACE_MISMATCH', retryable: false } };
    return { ok: true, value: active.human };
  }
  open(directory: string): Result<SpaceSession> {
    return this.adopt(Space.open(directory), directory);
  }
  create(directory: string, title: string): Result<SpaceSession> {
    return this.adopt(Space.create(directory, { title }), directory);
  }
  example(): Result<SpaceSession> {
    const directory = join(this.preferences.directory, 'example-space');
    return this.adopt(
      existsSync(directory) ? Space.open(directory) : createExampleSpace(directory),
      directory,
    );
  }
  private adopt(result: Result<Space>, directory: string): Result<SpaceSession> {
    if (!result.ok) return result;
    const human = result.value.human(this.preferences.installationNamespace);
    const status = human.status();
    if (!status.ok) {
      result.value.close();
      return status;
    }
    const saved = this.preferences.update({ lastSpace: directory });
    if (!saved.ok) {
      result.value.close();
      return saved;
    }
    const previous = this.#active;
    const session: SpaceSession = {
      bindingId: randomUUID(),
      status: status.value,
      locationLabel: basename(directory),
    };
    this.#active = { space: result.value, human, directory, session };
    previous?.space.close();
    return { ok: true, value: session };
  }
  validateAgent(grantId: string, token: string): Result<null> {
    if (!this.#active) return { ok: false, error: { code: 'SPACE_MISMATCH', retryable: false } };
    const result = this.#active.space.agent({
      grantId,
      token,
      instanceId: this.#active.session.status.instanceId,
    });
    return result.ok ? { ok: true, value: null } : result;
  }
  close(): void {
    this.#active?.space.close();
    this.#active = null;
  }
}
