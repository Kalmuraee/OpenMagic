/**
 * Tracks AbortControllers for in-flight LLM requests so they can be cancelled
 * when the client sends `llm.cancel` or its WebSocket disconnects. Without this,
 * a closed toolbar tab leaves the server's fetch() / CLI child process running —
 * burning tokens and, for CLI agents, potentially continuing to edit files.
 *
 * Requests are keyed `${connectionId}:${messageId}` so a whole connection's
 * requests can be aborted by prefix on disconnect.
 */
export class AbortRegistry {
  private controllers = new Map<string, AbortController>();

  register(id: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    return controller;
  }

  /** Abort and forget a single request. Returns false if it was already gone. */
  abort(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(id);
    return true;
  }

  /** Forget a request that finished normally (does NOT abort it). */
  complete(id: string): void {
    this.controllers.delete(id);
  }

  /** Abort every request whose id starts with `prefix`. Returns how many. */
  abortByPrefix(prefix: string): number {
    let count = 0;
    for (const [id, controller] of this.controllers) {
      if (id.startsWith(prefix)) {
        controller.abort();
        this.controllers.delete(id);
        count++;
      }
    }
    return count;
  }
}
