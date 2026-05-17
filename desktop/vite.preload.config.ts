import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "normalize-preload-output",
      configResolved(config) {
        const output = config.build.rollupOptions.output;
        if (output && !Array.isArray(output)) {
          delete (output as Record<string, unknown>).inlineDynamicImports;
          (output as Record<string, unknown>).codeSplitting = false;
        }
      }
    }
  ],
  build: {
    target: "chrome132",
    sourcemap: true
  }
});
