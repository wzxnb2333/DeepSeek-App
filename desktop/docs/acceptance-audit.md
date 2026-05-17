# DeepSeek App Windows 验收记录

本文记录桌面首版的可验证范围，方便后续发布前逐项复核。

## 功能范围

| 范围 | 验收点 | 状态 |
| --- | --- | --- |
| 桌面外壳 | Electron main、preload、React renderer 分层清晰 | 已实现 |
| sidecar | main 进程启动本地 runtime、随机端口、一次性 token | 已实现 |
| 退出清理 | 关闭窗口后停止 runtime 进程 | 已实现 |
| 配置 | 读取有效配置、更新 provider/model/approval/sandbox | 已实现 |
| 模型 | 模型列表可用于 composer 切换 | 已实现 |
| 项目 | 添加项目、切换项目、项目目录、文件打开、搜索 | 已实现 |
| 会话 | 新建线程、发送消息、SSE 流式事件、Markdown 渲染 | 已实现 |
| 审批 | 审批请求进入输入栏区域，支持允许、拒绝、以后都运行、终止当前 turn | 已实现 |
| 任务 | 创建、取消、打开结果会话、清理已结束任务 | 已实现 |
| 自动化 | 暂停、恢复、运行、展示状态 | 已实现 |
| 设置 | 多目录设置页，包含 runtime、MCP、技能、日志和密钥来源状态 | 已实现 |
| 打包 | Windows x64 unpacked、Squirrel installer、ZIP | 已实现 |

## 发布前命令

```powershell
cargo build --release --bin deepseek --bin deepseek-tui
npm --prefix desktop run typecheck
npm --prefix desktop run lint
npm --prefix desktop run test
npm --prefix desktop run build
npm --prefix desktop run make:win
npm --prefix desktop run verify:make
```

## 人工复核

- 双击安装包安装并启动。
- 无密钥时能进入设置状态，界面不显示真实密钥。
- 添加一个项目后，新建会话停留不会自动跳回其他项目线程。
- 发送消息后，正文区域保留最终回复，过程信息按 turn 折叠。
- 触发工具审批时，输入栏区域出现审批操作。
- YOLO 模式下可按线程记住模式、模型和思考强度。
- 项目目录可横向和纵向滚动，文件双击可用系统默认方式打开。

## 已知限制

- 首版只声明 Windows x64。
- 安装包未签名。
- 暂无自动更新。
- Release 产物应放在 GitHub Release，不提交进源码仓库。
