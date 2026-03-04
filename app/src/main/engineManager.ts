import { UpscaleEngine, EngineId } from '../shared/types';

/**
 * Central registry of all upscale engines.
 * New engines are registered here and become available throughout the app.
 */
class EngineManager {
  private engines = new Map<EngineId, UpscaleEngine>();

  register(engine: UpscaleEngine): void {
    this.engines.set(engine.id, engine);
  }

  get(id: EngineId): UpscaleEngine | undefined {
    return this.engines.get(id);
  }

  getAll(): UpscaleEngine[] {
    return Array.from(this.engines.values());
  }

  getIds(): EngineId[] {
    return Array.from(this.engines.keys());
  }

  has(id: EngineId): boolean {
    return this.engines.has(id);
  }
}

export const engineManager = new EngineManager();
