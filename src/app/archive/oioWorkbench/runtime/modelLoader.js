const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MOBILE_RE = /Android|iPhone|iPad|iPod|Mobile/i;
const SIMD_WASM_BYTES = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28,
  0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  253, 186, 1, 26, 11,
]);

function isMobileClient() {
  return MOBILE_RE.test(navigator.userAgent || "");
}

function hasWasmSimdSupport() {
  try {
    return WebAssembly.validate(SIMD_WASM_BYTES);
  } catch {
    return false;
  }
}

function hasThreadSupport() {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    typeof Atomics !== "undefined" &&
    self.crossOriginIsolated === true
  );
}

export class ModelController {
  constructor({ setStatus }) {
    this.setStatus = setStatus;
    this.ttsInstance = null;
    this.KokoroTTSCtor = null;
    this.runtimeProfile = null;
  }

  async getKokoroTTSModule() {
    if (this.KokoroTTSCtor) {
      return { KokoroTTS: this.KokoroTTSCtor };
    }
    const mod = await import("kokoro-js");
    this.KokoroTTSCtor = mod.KokoroTTS;
    return mod;
  }

  async getKokoroTTS() {
    const mod = await this.getKokoroTTSModule();
    return mod.KokoroTTS;
  }

  async getRuntimeProfile() {
    if (this.runtimeProfile) return this.runtimeProfile;

    let webgpuAvailable = false;
    if (navigator.gpu) {
      try {
        webgpuAvailable = !!(await navigator.gpu.requestAdapter());
      } catch {
        webgpuAvailable = false;
      }
    }

    this.runtimeProfile = {
      isMobile: isMobileClient(),
      webgpuAvailable,
      wasmSimdAvailable: hasWasmSimdSupport(),
      threadsAvailable: hasThreadSupport(),
      hardwareConcurrency: Math.max(1, navigator.hardwareConcurrency || 1),
    };
    return this.runtimeProfile;
  }

  progressCallback(info) {
    if (info?.status === "progress" && typeof info.progress === "number") {
      this.setStatus(`正在加载模型… ${Math.round(info.progress)}%`);
    } else if (info?.status === "download") {
      this.setStatus("正在下载模型文件…");
    }
  }

  async configureWasmRuntime(profile) {
    void profile;
  }

  describeAttempt(attempt, profile) {
    if (attempt.device === "webgpu") return "GPU 加速";
    if (attempt.simdExpected && profile.wasmSimdAvailable) return "WASM SIMD";
    return "WASM 兼容模式";
  }

  getLoadAttempts(profile) {
    const attempts = [];
    if (profile.webgpuAvailable) {
      attempts.push({
        device: "webgpu",
        dtype: "fp32",
        readyLabel: "模型已就绪（GPU）。",
      });
    }

    const wasmDtypes = profile.isMobile ? ["q4", "q8"] : ["q8", "q4"];
    for (const dtype of wasmDtypes) {
      attempts.push({
        device: "wasm",
        dtype,
        simdExpected: true,
        readyLabel:
          dtype === "q4"
            ? "模型已就绪（轻量兼容模式）。"
            : "模型已就绪（兼容模式）。",
      });
    }
    return attempts;
  }

  async loadModel() {
    if (this.ttsInstance) return this.ttsInstance;

    const profile = await this.getRuntimeProfile();
    await this.configureWasmRuntime(profile);

    const KokoroTTS = await this.getKokoroTTS();
    const baseOpts = { progress_callback: (info) => this.progressCallback(info) };
    const errors = [];

    for (const attempt of this.getLoadAttempts(profile)) {
      const label = this.describeAttempt(attempt, profile);
      this.setStatus(`正在加载模型（${label}）…`);
      try {
        this.ttsInstance = await KokoroTTS.from_pretrained(MODEL_ID, {
          ...baseOpts,
          dtype: attempt.dtype,
          device: attempt.device,
        });
        this.setStatus(attempt.readyLabel);
        return this.ttsInstance;
      } catch (error) {
        console.warn(`模型加载失败，将继续降级（${attempt.device}/${attempt.dtype}）`, error);
        this.ttsInstance = null;
        errors.push(`${attempt.device}/${attempt.dtype}: ${error?.message || error}`);
      }
    }

    throw new Error(
      `当前设备未能成功加载语音模型。${
        profile.isMobile ? "请先尝试更短文本，或换到系统浏览器后重试。 " : ""
      }${errors[errors.length - 1] || "请稍后重试。"}`,
    );
  }

  reset() {
    this.ttsInstance = null;
  }
}
