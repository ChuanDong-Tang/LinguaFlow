type KokoroDtype = "q8" | "q4";

type KokoroWorkerInitRequest = {
  id: number;
  type: "init";
  modelId: string;
  device: "wasm" | "webgpu";
  dtype: KokoroDtype;
};

type KokoroWorkerGenerateRequest = {
  id: number;
  type: "generate";
  text: string;
  voice: string;
};

type KokoroWorkerRequest = KokoroWorkerInitRequest | KokoroWorkerGenerateRequest;

type KokoroWorkerInitResponse = {
  id: number;
  ok: true;
  type: "init";
};

type KokoroWorkerGenerateResponse = {
  id: number;
  ok: true;
  type: "generate";
  audio: ArrayBuffer;
  sampleRate: number;
};

type KokoroWorkerErrorResponse = {
  id: number;
  ok: false;
  type: "error";
  stage: "init" | "generate";
  error: string;
};

type KokoroWorkerResponse =
  | KokoroWorkerInitResponse
  | KokoroWorkerGenerateResponse
  | KokoroWorkerErrorResponse;

export class KokoroWorkerClient {
  private readonly worker: Worker;
  private requestId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<number, { resolve: (value: KokoroWorkerResponse) => void; reject: (reason?: unknown) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./kokoroTtsWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<KokoroWorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message);
        return;
      }
      pending.reject(new Error(message.error || "Kokoro worker request failed"));
    };
    this.worker.onerror = (event: ErrorEvent) => {
      const reason = new Error(event.message || "Kokoro worker crashed");
      const pendingList = Array.from(this.pending.values());
      this.pending.clear();
      for (const pending of pendingList) {
        pending.reject(reason);
      }
    };
  }

  async init(modelId: string, device: "wasm" | "webgpu", dtype: KokoroDtype): Promise<void> {
    await this.enqueue(async () => {
      await this.request({
        id: this.nextId(),
        type: "init",
        modelId,
        device,
        dtype,
      });
    });
  }

  async generate(text: string, voice: string): Promise<{ audio: Float32Array; sampleRate: number }> {
    return this.enqueue(async () => {
      const response = await this.request({
        id: this.nextId(),
        type: "generate",
        text,
        voice,
      });
      if (response.type !== "generate") {
        throw new Error("Unexpected Kokoro worker response type");
      }
      return {
        audio: new Float32Array(response.audio),
        sampleRate: response.sampleRate,
      };
    });
  }

  terminate(): void {
    const pendingList = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of pendingList) {
      pending.reject(new Error("Kokoro worker terminated"));
    }
    this.worker.terminate();
  }

  private nextId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private request(payload: KokoroWorkerRequest): Promise<KokoroWorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(payload.id, { resolve, reject });
      this.worker.postMessage(payload);
    });
  }
}
