export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface Manifest {
  readonly version: 1;
  readonly generation: string;
  readonly count: number;
}

const encodeKey = (value: string): string =>
  Array.from(
    value,
    (character) => character.codePointAt(0)?.toString(16) ?? "0",
  ).join("_");

const parseManifest = (value: string | null): Manifest | null => {
  if (!value) return null;
  try {
    const candidate = JSON.parse(value) as Partial<Manifest>;
    if (
      candidate.version === 1 &&
      typeof candidate.generation === "string" &&
      Number.isSafeInteger(candidate.count) &&
      (candidate.count ?? 0) >= 0
    ) {
      return candidate as Manifest;
    }
  } catch {
    return null;
  }
  return null;
};

let generationSequence = 0;

const mutationQueues = new WeakMap<StringStorage, Map<string, Promise<void>>>();

export class ChunkedStorage implements StringStorage {
  constructor(
    private readonly storage: StringStorage,
    private readonly chunkSize = 1800,
  ) {
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 128) {
      throw new Error(
        "chunkSize must be an integer of at least 128 characters",
      );
    }
  }

  async #mutate(key: string, operation: () => Promise<void>): Promise<void> {
    let queues = mutationQueues.get(this.storage);
    if (!queues) {
      queues = new Map();
      mutationQueues.set(this.storage, queues);
    }
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    queues.set(key, current);
    try {
      await current;
    } finally {
      if (queues.get(key) === current) queues.delete(key);
    }
  }

  async getItem(key: string): Promise<string | null> {
    const baseKey = encodeKey(key);
    const manifest = parseManifest(
      await this.storage.getItem(`${baseKey}.manifest`),
    );
    if (!manifest) return null;

    const chunks = await Promise.all(
      Array.from({ length: manifest.count }, (_, index) =>
        this.storage.getItem(`${baseKey}.${manifest.generation}.${index}`),
      ),
    );
    if (chunks.some((chunk) => chunk === null)) return null;
    return chunks.join("");
  }

  async setItem(key: string, value: string): Promise<void> {
    return this.#mutate(key, async () => {
      const baseKey = encodeKey(key);
      const manifestKey = `${baseKey}.manifest`;
      const previous = parseManifest(await this.storage.getItem(manifestKey));
      const generation = `${Date.now().toString(36)}_${(generationSequence += 1).toString(36)}`;
      const chunks =
        value.match(new RegExp(`.{1,${this.chunkSize}}`, "gs")) ?? [];

      await Promise.all(
        chunks.map((chunk, index) =>
          this.storage.setItem(`${baseKey}.${generation}.${index}`, chunk),
        ),
      );
      await this.storage.setItem(
        manifestKey,
        JSON.stringify({
          version: 1,
          generation,
          count: chunks.length,
        } satisfies Manifest),
      );

      if (previous) {
        await Promise.all(
          Array.from({ length: previous.count }, (_, index) =>
            this.storage.removeItem(
              `${baseKey}.${previous.generation}.${index}`,
            ),
          ),
        );
      }
    });
  }

  async removeItem(key: string): Promise<void> {
    return this.#mutate(key, async () => {
      const baseKey = encodeKey(key);
      const manifestKey = `${baseKey}.manifest`;
      const manifest = parseManifest(await this.storage.getItem(manifestKey));
      if (!manifest) {
        await this.storage.removeItem(manifestKey);
        return;
      }

      const removals = await Promise.allSettled(
        Array.from({ length: manifest.count }, (_, index) =>
          Promise.resolve().then(() =>
            this.storage.removeItem(
              `${baseKey}.${manifest.generation}.${index}`,
            ),
          ),
        ),
      );
      if (removals.some((result) => result.status === "rejected"))
        throw new Error("Stored data cleanup is incomplete.");
      await this.storage.removeItem(manifestKey);
    });
  }
}
