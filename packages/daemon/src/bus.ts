import type { LiveEvent } from "@atlas/core";
import { EventEmitter } from "node:events";

/** In-process fan-out of store changes to SSE subscribers. */
export class Bus {
  private readonly emitter = new EventEmitter().setMaxListeners(100);

  emit(event: LiveEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(fn: (event: LiveEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }
}
