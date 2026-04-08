import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@huggingface/transformers", "onnxruntime-web", "phonemizer"],
  },
  build: {
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@huggingface/transformers")) return "hf-transformers";
          if (id.includes("onnxruntime-web")) return "onnxruntime";
          if (id.includes("kokoro-js")) return "kokoro";
          if (id.includes("jszip")) return "jszip";
          return "vendor";
        },
      },
    },
  },
});
