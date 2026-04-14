type KokoroGenerateResult = {
  audio?: Float32Array | number[] | ArrayLike<number> | null;
  sampling_rate?: number;
  sample_rate?: number;
};

type KokoroTtsInstance = {
  generate: (text: string, options?: { voice?: string }) => Promise<KokoroGenerateResult>;
};

type InitRequest = {
  id: number;
  type: "init";
  modelId: string;
  device: "wasm" | "webgpu";
  dtype: "q8" | "q4";
};

type GenerateRequest = {
  id: number;
  type: "generate";
  text: string;
  voice: string;
};

type WorkerRequest = InitRequest | GenerateRequest;

type InitResponse = {
  id: number;
  ok: true;
  type: "init";
};

type GenerateResponse = {
  id: number;
  ok: true;
  type: "generate";
  audio: ArrayBuffer;
  sampleRate: number;
};

type ErrorResponse = {
  id: number;
  ok: false;
  type: "error";
  stage: "init" | "generate";
  error: string;
};

type WorkerResponse = InitResponse | GenerateResponse | ErrorResponse;

let ttsInstancePromise: Promise<KokoroTtsInstance> | null = null;
let initConfig: { modelId: string; device: "wasm" | "webgpu"; dtype: "q8" | "q4" } | null = null;

function toFloat32Array(input: Float32Array | number[] | ArrayLike<number>): Float32Array {
  if (input instanceof Float32Array) return input;
  const length = typeof input.length === "number" ? input.length : 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(input[i] ?? 0);
  }
  return out;
}

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, transfer);
}

async function loadTts(modelId: string, device: "wasm" | "webgpu", dtype: "q8" | "q4"): Promise<KokoroTtsInstance> {
  initConfig = { modelId, device, dtype };
  if (!ttsInstancePromise) {
    ttsInstancePromise = (async () => {
      const mod = (await import("kokoro-js")) as {
        KokoroTTS: {
          from_pretrained: (
            id: string,
            options: { device: "wasm" | "webgpu"; dtype: "q8" | "q4" },
          ) => Promise<KokoroTtsInstance>;
        };
      };
      return mod.KokoroTTS.from_pretrained(modelId, { device, dtype });
    })();
  }
  return ttsInstancePromise;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (!message || typeof message.id !== "number") return;

  if (message.type === "init") {
    try {
      await loadTts(message.modelId, message.device, message.dtype);
      post({ id: message.id, ok: true, type: "init" });
    } catch (error) {
      post({
        id: message.id,
        ok: false,
        type: "error",
        stage: "init",
        error: String((error as Error)?.message ?? error ?? "unknown"),
      });
    }
    return;
  }

  try {
    if (!initConfig) {
      throw new Error("Kokoro worker not initialized");
    }
    const tts = await loadTts(initConfig.modelId, initConfig.device, initConfig.dtype);
    const result = await tts.generate(message.text, { voice: message.voice });
    const audioData = result?.audio;
    const sampleRate = Number(result?.sampling_rate ?? result?.sample_rate ?? 24_000);
    if (!audioData || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error("Invalid Kokoro audio output");
    }
    const samples = toFloat32Array(audioData);
    post(
      {
        id: message.id,
        ok: true,
        type: "generate",
        audio: samples.buffer,
        sampleRate,
      },
      [samples.buffer],
    );
  } catch (error) {
    post({
      id: message.id,
      ok: false,
      type: "error",
      stage: "generate",
      error: String((error as Error)?.message ?? error ?? "unknown"),
    });
  }
};
