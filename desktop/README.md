# DeepSeek App Desktop

这是 DeepSeek App 的 Windows 桌面工程。界面层使用 Electron、React、TypeScript 和 Vite；智能体能力复用仓库内 Rust runtime，通过本地 HTTP/SSE API 通信。

![DeepSeek App screenshot](docs/screenshot-main.png)

## 安装

普通用户直接从 GitHub Releases 下载：

- [DeepSeekAppSetup.exe](https://github.com/wzxnb2333/DeepSeek-App/releases/latest)：安装版。
- `DeepSeek App-win32-x64-0.1.0.zip`：便携版，解压后运行 `deepseek-app.exe`。

首版只验证 Windows x64。安装包暂未签名，Windows 可能显示 SmartScreen 提醒。

## 架构

- `src/main.ts`：Electron main，负责窗口、sidecar supervisor、token 管理、健康检查和退出清理。
- `src/preload.ts`：通过 `contextBridge` 暴露受限桌面 API。
- `src/renderer/`：React UI、typed API client、SSE 数据层、项目/线程/任务/自动化状态。
- `assets/`：应用图标。
- `docs/`：截图、验收记录和 release notes。
- `scripts/`：打包、runtime smoke、安装包和 release 验证脚本。

打包时 `forge.config.cjs` 会把 `target\release\deepseek.exe` 和 `target\release\deepseek-tui.exe` 复制到应用的 `resources\bin\`。缺少任一 runtime 二进制时打包会失败。

## 开发

需要：

- Windows 10/11 x64。
- Rust 1.88 或更高版本。
- Node.js 20 或更高版本。
- Visual Studio Build Tools，包含 C++ 桌面开发和 Windows SDK。

构建 runtime：

```powershell
cargo build --release --bin deepseek --bin deepseek-tui
```

安装依赖并启动：

```powershell
npm --prefix desktop install
npm --prefix desktop run dev
```

也可以手动指定 runtime 和默认工作区：

```powershell
$env:DEEPSEEK_DESKTOP_BINARY = "E:\path\to\deepseek.exe"
$env:DEEPSEEK_DESKTOP_WORKSPACE = "E:\path\to\workspace"
npm --prefix desktop run dev
```

## 打包

```powershell
cargo build --release --bin deepseek --bin deepseek-tui
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```

产物：

- 解包版：`desktop\out\DeepSeek App-win32-x64\deepseek-app.exe`
- 安装包：`desktop\out\make\squirrel.windows\x64\DeepSeekAppSetup.exe`
- Squirrel 更新包：`desktop\out\make\squirrel.windows\x64\deepseek_app-0.1.0-full.nupkg`
- Squirrel 索引：`desktop\out\make\squirrel.windows\x64\RELEASES`
- 便携 ZIP：`desktop\out\make\zip\win32\x64\DeepSeek App-win32-x64-0.1.0.zip`

## 验证

常规桌面验证：

```powershell
npm --prefix desktop run typecheck
npm --prefix desktop run lint
npm --prefix desktop run test
npm --prefix desktop run build
```

发布前验证：

```powershell
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```

Runtime API 合同测试：

```powershell
cargo test -p deepseek-tui runtime_api
```

## 发布清单

1. 扫描 diff，确认没有真实 API key、本机隐私路径或构建产物进入提交。
2. 构建 release runtime。
3. 运行桌面 typecheck、lint、test、build。
4. 运行 `make:win` 和 `verify:make`。
5. 上传 `DeepSeekAppSetup.exe`、`.nupkg`、`RELEASES` 和便携 ZIP 到 GitHub Release。
6. release notes 写明未签名、无自动更新、仅 Windows x64。

## 安全边界

- renderer 不直接读取文件系统、环境变量或系统密钥。
- runtime token 由 main 进程生成，只在本机进程间传递。
- provider 密钥不应进入前端状态、截图、日志、crash dump、Git 历史或 release 文档。
- 项目目录浏览只通过 runtime 的工作区 API 完成。
