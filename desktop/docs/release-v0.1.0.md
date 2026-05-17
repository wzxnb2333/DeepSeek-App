# DeepSeek App Windows v0.1.0

首个 Windows x64 桌面预览版。

## 安装

推荐下载 `DeepSeekAppSetup.exe`。如果不想安装，也可以下载 ZIP，解压后运行 `deepseek-app.exe`。

## 包含内容

- Electron + React + TypeScript 桌面工作台。
- 内置 Rust runtime：`deepseek.exe` 和 `deepseek-tui.exe`。
- 项目、会话、流式回复、工具审批、任务、自动化、设置、MCP、技能、用量和日志入口。
- 本地 sidecar 自动启动、随机端口、一次性 runtime token、退出清理。
- Windows 安装包和便携 ZIP。

## 首次使用

1. 启动应用。
2. 添加一个本地项目。
3. 在设置中配置 provider、模型和密钥来源。
4. 新建会话并发送请求。

## 已知限制

- 仅验证 Windows x64。
- 安装包暂未代码签名，Windows 可能出现 SmartScreen 提醒。
- 暂不包含自动更新。
- 不会迁移已有本地数据，只读取并复用本机配置。

## 校验

发布前已执行：

```powershell
npm --prefix desktop run typecheck
npm --prefix desktop run lint
npm --prefix desktop run test
npm --prefix desktop run build
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```
