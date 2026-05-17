# DeepSeek App Windows

DeepSeek App 是 DeepSeek TUI 的 Windows 桌面工作台。界面层使用 Electron、React 和 TypeScript；实际智能体运行时仍复用本仓库的 Rust runtime，通过本地 HTTP/SSE API 通信。

![DeepSeek App screenshot](docs/screenshot-main.png)

## 当前状态

- 目标平台：Windows x64。
- 打包形态：安装包和 ZIP 都会捆绑 `deepseek.exe` 与 `deepseek-tui.exe`。
- 桌面端不直接持有 Node 权限；renderer 只通过 preload 暴露的受限 API 访问本地 runtime。
- 密钥只应来自本机配置、环境变量或系统凭据；不要写入源码、README、日志或截图。
- 代码签名和自动更新暂不包含在首版范围内，因此 Windows 可能显示 SmartScreen 提醒。

## 给普通用户安装

推荐从 GitHub Release 下载 Windows x64 产物：

- `DeepSeekAppSetup.exe`：Squirrel 安装包，适合长期使用。
- `DeepSeek App-win32-x64-0.1.0.zip`：便携 ZIP，解压后运行 `deepseek-app.exe`。

安装后首次启动：

1. 点击“添加项目”，选择一个本地工作区。
2. 打开“设置”，配置 provider、模型、审批模式和密钥来源。
3. 回到“项目”，点击“新会话”开始一次线程。

应用会在本机启动 sidecar runtime，端口随机分配，并用一次性 token 保护本地 HTTP API。关闭窗口后 sidecar 会退出。

## 从源码开发

需要：

- Windows 10/11 x64。
- Rust 1.88 或更高版本。
- Node.js 20 或更高版本。
- Visual Studio Build Tools，包含“使用 C++ 的桌面开发”和 Windows SDK。

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

## 打包 Windows 产物

先确保 release runtime 已构建：

```powershell
cargo build --release --bin deepseek --bin deepseek-tui
```

生成解包版：

```powershell
npm --prefix desktop run package:win
```

生成安装包和 ZIP：

```powershell
npm --prefix desktop run make:win
```

产物位置：

- 解包版：`desktop\out\DeepSeek App-win32-x64\deepseek-app.exe`
- 安装包：`desktop\out\make\squirrel.windows\x64\DeepSeekAppSetup.exe`
- 便携 ZIP：`desktop\out\make\zip\win32\x64\DeepSeek App-win32-x64-0.1.0.zip`

打包时 `desktop\forge.config.cjs` 会把 `deepseek.exe` 和 `deepseek-tui.exe` 复制到 `resources\bin\`。如果缺少这两个二进制，打包会直接失败。

## 验证

常规桌面验证：

```powershell
npm --prefix desktop run typecheck
npm --prefix desktop run lint
npm --prefix desktop run test
npm --prefix desktop run build
npm --prefix desktop run package:win
npm --prefix desktop run verify:package
```

发布前验证安装包和 ZIP：

```powershell
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```

Rust runtime 验证：

```powershell
cargo test -p deepseek-tui runtime_api
cargo test --workspace --all-features
cargo clippy --workspace --all-targets --all-features
```

## Release 检查清单

1. 确认没有真实 API key 或本地路径隐私进入 diff。
2. 构建 release runtime。
3. 运行桌面 typecheck、lint、test、build。
4. 运行 `make:win` 和 `verify:make`。
5. 上传安装包与 ZIP 到 GitHub Release。
6. Release notes 写明“未签名、无自动更新、仅 Windows x64”。

## 安全边界

- renderer 不直接读取文件系统、环境变量或系统密钥。
- runtime token 由 main 进程生成，只在本机进程间传递。
- API key 不应该进入前端状态、截图、日志、crash dump、Git 历史或 Release 文案。
- 项目目录浏览只通过 runtime 的工作区 API 完成。
