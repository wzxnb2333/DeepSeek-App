const path = require("node:path");
const { VitePlugin } = require("@electron-forge/plugin-vite");

module.exports = {
  packagerConfig: {
    asar: true,
    icon: path.resolve(__dirname, "assets", "icon"),
    name: "DeepSeek App",
    executableName: "deepseek-app",
    download: {
      checksums: {
        "electron-v42.0.1-win32-x64.zip": "260351302fe1adac1d85a87ac8d7b3d2a3b0e5b95b051dee5ecf5d4555b86c79"
      }
    }
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "deepseek_app",
        authors: "DeepSeek App contributors",
        exe: "deepseek-app.exe",
        setupIcon: path.resolve(__dirname, "assets", "icon.ico"),
        setupExe: "DeepSeekAppSetup.exe"
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"]
    }
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main"
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts"
        }
      ]
    })
  ],
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      const fs = require("node:fs");
      const candidates = new Map([
        [
          "deepseek.exe",
          [
            path.resolve(__dirname, "..", "target", "release", "deepseek.exe"),
            path.resolve(__dirname, "..", "target", "debug", "deepseek.exe")
          ]
        ],
        [
          "deepseek-tui.exe",
          [
            path.resolve(__dirname, "..", "target", "release", "deepseek-tui.exe"),
            path.resolve(__dirname, "..", "target", "debug", "deepseek-tui.exe")
          ]
        ]
      ]);
      const binDir = path.join(path.dirname(buildPath), "bin");
      fs.mkdirSync(binDir, { recursive: true });
      for (const [name, paths] of candidates) {
        const source = paths.find((candidate) => fs.existsSync(candidate));
        if (source) {
          fs.copyFileSync(source, path.join(binDir, name));
        }
      }
      const missing = ["deepseek.exe", "deepseek-tui.exe"].filter(
        (name) => !fs.existsSync(path.join(binDir, name))
      );
      if (missing.length > 0) {
        throw new Error(
          `Missing runtime binaries: ${missing.join(", ")}. Run cargo build --release --bin deepseek --bin deepseek-tui first.`
        );
      }
    }
  }
};
