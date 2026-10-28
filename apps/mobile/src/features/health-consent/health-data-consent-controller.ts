import type { ApiClient } from "@mizyun/api-client";

import {
  loadHealthDataConsent,
  readCachedHealthDataConsent,
  saveHealthDataConsent,
  type ConsentCacheStore,
  type LoadedHealthDataConsent,
} from "./health-data-consent";

/**
 * Loads and refreshes one user's health-data consent for the session gate.
 * Plain class so the ordering rules are testable without React:
 *
 * - A cached grant is shown at once unless the server answer arrived first.
 * - A foreground refresh runs only once an answer is on screen; its failure
 *   keeps that answer, and it never cancels the first load.
 * - Every save, retry or dispose starts a new generation, and results (and
 *   their cache writes) from an older generation are dropped.
 */
export class HealthDataConsentController {
  readonly #userId: string;
  readonly #client: ApiClient;
  readonly #store: ConsentCacheStore;
  readonly #onChange: (state: LoadedHealthDataConsent | null) => void;
  #generation = 0;
  #state: LoadedHealthDataConsent | null = null;

  constructor(options: {
    readonly userId: string;
    readonly client: ApiClient;
    readonly store: ConsentCacheStore;
    readonly onChange: (state: LoadedHealthDataConsent | null) => void;
  }) {
    this.#userId = options.userId;
    this.#client = options.client;
    this.#store = options.store;
    this.#onChange = options.onChange;
  }

  get state(): LoadedHealthDataConsent | null {
    return this.#state;
  }

  #set(state: LoadedHealthDataConsent | null): void {
    this.#state = state;
    this.#onChange(state);
  }

  /** First load, and Try again: cache first, then the server. */
  start(): Promise<void> {
    const generation = ++this.#generation;
    const isCurrent = () => generation === this.#generation;
    let answered = false;
    if (this.#state !== null) this.#set(null);
    const cached = readCachedHealthDataConsent(this.#userId, this.#store).then(
      (cachedAnswer) => {
        if (!answered && isCurrent() && cachedAnswer?.status === "granted") {
          this.#set(cachedAnswer);
        }
      },
    );
    const loaded = loadHealthDataConsent(
      this.#userId,
      this.#client,
      this.#store,
      isCurrent,
    ).then((answer) => {
      answered = true;
      // A failed check keeps a cached grant already on screen.
      if (!isCurrent()) return;
      if (!answer.confirmedByServer && this.#state?.status === "granted")
        return;
      this.#set(answer);
    });
    return Promise.all([cached, loaded]).then(() => undefined);
  }

  /** App back in the foreground: re-ask the server if an answer is shown. */
  async refresh(): Promise<void> {
    if (this.#state === null) return;
    const generation = this.#generation;
    const isCurrent = () => generation === this.#generation;
    const answer = await loadHealthDataConsent(
      this.#userId,
      this.#client,
      this.#store,
      isCurrent,
    );
    if (isCurrent() && answer.confirmedByServer) this.#set(answer);
  }

  /** Records a grant or withdrawal; resolves to an error message or null. */
  async save(granted: boolean): Promise<string | null> {
    const generation = ++this.#generation;
    const result = await saveHealthDataConsent(
      this.#userId,
      granted,
      this.#client,
      this.#store,
    );
    if (!result.ok) return result.message;
    if (generation !== this.#generation) return null;
    // Drops a foreground refresh that started while this save was pending:
    // its answer may predate the save.
    this.#generation += 1;
    this.#set(result.consent);
    return null;
  }

  dispose(): void {
    this.#generation += 1;
  }
}
