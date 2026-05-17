# DeepSeek App

DeepSeek App 是一个面向 Windows 的本地智能体桌面工作台。它把项目、线程、流式回复、工具审批、任务、自动化、MCP、技能、用量和运行日志放进一个桌面界面里，底层复用本仓库的 Rust runtime。

![DeepSeek App screenshot](desktop/docs/screenshot-main.png)

## 下载安装

推荐从 GitHub Releases 下载 Windows x64 版本：

- [DeepSeekAppSetup.exe](https://github.com/wzxnb2333/DeepSeek-App/releases/latest)：安装版，适合长期使用。
- `DeepSeek App-win32-x64-0.1.0.zip`：便携版，解压后运行 `deepseek-app.exe`。

首次启动后：

1. 添加一个本地项目目录。
2. 在设置中配置 provider、模型、审批模式和密钥来源。
3. 在项目下新建线程并开始对话。

如果没有 API key，应用会进入可理解的设置状态，不会在界面、日志、截图或 release 文档中显示真实密钥。

## 产品定位

DeepSeek App 不是官网页，也不是单纯的聊天壳。它是一个本地代码工作台：

- 项目和线程分离，线程归属于项目。
- 回复正文保留在聊天区，思考、工具调用和状态过程按轮次折叠。
- 工具审批会出现在输入区附近，支持允许一次、拒绝、以后都运行和中断当前轮次。
- 输入栏固定在底部，Enter 发送，Ctrl+Enter 换行。
- 右侧用于项目目录、上下文、审批和设置入口，避免把运行过程铺满主屏。
- 桌面端通过 preload 暴露受限 API，renderer 不直接拥有 Node 权限。
- main 进程启动本地 sidecar runtime，随机端口加一次性 token，关闭窗口后清理进程。

## 当前状态

- 平台：Windows x64。
- 打包：Squirrel 安装包和便携 ZIP。
- 捆绑内容：`deepseek.exe` 与 `deepseek-tui.exe` 两个 Rust runtime 二进制。
- 桌面技术栈：Electron、React、TypeScript、Vite。
- 后端接口：本地 HTTP/SSE runtime API。
- 首版不包含代码签名和自动更新，Windows 可能显示 SmartScreen 提醒。

## 从源码运行

需要：

- Windows 10/11 x64。
- Rust 1.88 或更高版本。
- Node.js 20 或更高版本。
- Visual Studio Build Tools，包含 C++ 桌面开发和 Windows SDK。

构建 runtime：

```powershell
cargo build --release --bin deepseek --bin deepseek-tui
```

安装桌面依赖并启动开发模式：

```powershell
npm --prefix desktop install
npm --prefix desktop run dev
```

开发模式会优先查找：

1. `target\release\deepseek.exe`
2. `target\release\deepseek-tui.exe`
3. `target\debug\deepseek.exe`
4. `target\debug\deepseek-tui.exe`

也可以通过环境变量指定：

```powershell
$env:DEEPSEEK_DESKTOP_BINARY = "E:\path\to\deepseek.exe"
$env:DEEPSEEK_DESKTOP_WORKSPACE = "E:\path\to\workspace"
npm --prefix desktop run dev
```

## 打包

先构建 release runtime：

```powershell
cargo build --release --bin deepseek --bin deepseek-tui
```

生成 Windows 安装包和 ZIP：

```powershell
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```

产物位置：

- 解包版：`desktop\out\DeepSeek App-win32-x64\deepseek-app.exe`
- 安装包：`desktop\out\make\squirrel.windows\x64\DeepSeekAppSetup.exe`
- Squirrel 更新包：`desktop\out\make\squirrel.windows\x64\deepseek_app-0.1.0-full.nupkg`
- Squirrel 索引：`desktop\out\make\squirrel.windows\x64\RELEASES`
- 便携 ZIP：`desktop\out\make\zip\win32\x64\DeepSeek App-win32-x64-0.1.0.zip`

## 验证

桌面端：

```powershell
npm --prefix desktop run typecheck
npm --prefix desktop run lint
npm --prefix desktop run test
npm --prefix desktop run build
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```

Rust runtime：

```powershell
cargo test -p deepseek-tui runtime_api
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features
```

## 安全边界

- 不要把真实 API key 写入源码、README、截图、日志、提交或 release notes。
- provider 密钥只应来自本机配置、环境变量或系统凭据。
- renderer 不直接读取文件系统、环境变量或系统密钥。
- runtime token 由 main 进程生成，只在本机进程间传递。
- release 产物放在 GitHub Release，不提交进源码仓库。

## 目录

- `desktop/`：Electron 桌面应用。
- `desktop/README.md`：桌面开发、打包、发布细节。
- `desktop/docs/release-v0.1.0.md`：首版 release notes。
- `desktop/docs/acceptance-audit.md`：验收清单。
- `crates/`：Rust runtime、CLI 和 TUI 基础能力。
