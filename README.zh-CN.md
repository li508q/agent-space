<p align="center"><img src="docs/assets/banner.svg" alt="AgentSpace" width="1200"></p>

<p align="center"><a href="README.md">English</a> · 简体中文 · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a></p>

**让人始终掌握方向，让智能充分发挥。**

AgentSpace 是你拥有的本地工作空间。你可以直接写作，也可以与不同 Agent 共用上下文。修改的原因、引用的版本和实际变化清楚可见，由你决定哪些内容进入长期积累。

<img src="docs/assets/workbench.zh-CN.png" alt="AgentSpace 真实桌面界面，使用合成示例内容" width="1200">

## 核心能力

- **直接写作与组织。** 统一笔记、文档、项目、轻量记录与可复用资产引用。
- **准确提供上下文。** 用带权限范围的 MCP 或 CLI 连接 Agent；按任务组合筛选、搜索、关系遍历与精确版本读取。
- **看懂每次修改。** 查看提案目的、理由、差异与证据，再决定是否采纳。采纳后的说明可以由下一个有权限的 Agent 继续追溯。
- **保留自己的工作。** 恢复草稿、检查历史；撤销时保护后续修改。
- **带入与带走资料。** 先预览目录导入；按需生成完整历史备份或当前内容的可阅读导出。
- **使用熟悉的语言。** 支持英文、简体中文、日文、韩文和西班牙文；你写的内容保留原语言。

无需模型账号即可独立使用。需要 Agent 协助时，再连接你已经使用的工具。

<img src="docs/assets/review.zh-CN.png" alt="真实 Agent 提案：修改理由、差异与精确来源" width="1200">

## 本地开始

首次交付面向 macOS Apple Silicon。可以使用本地构建的应用，或从源码运行：

```sh
git clone https://github.com/li508q/agent-space.git
cd agent-space
npm ci
npm run dev
```

使用 [`.nvmrc`](.nvmrc) 指定的 Node 版本。打开有明确标识的示例空间，或创建自己的本地空间。[使用指南 →](docs/guides/zh-CN.md)

在 Apple Silicon Mac 上运行 `npm run package:mac` 可构建独立应用，内置运行时。[桌面构建说明 →](docs/DESKTOP.md)

连接 Agent 时，在设置的 Agent 访问区域选择权限范围，复制生成的配置。创建新笔记或记录需要单独启用权限；Agent 提案经过你的审阅后才会成为正式内容。[MCP 与 CLI →](docs/AGENT_PROTOCOL.md)

## 一份数据，清楚的边界

Electron 桌面与真实 MCP/CLI 共用事务性 SQLite 内核。稳定对象 ID、带类型的关系、精确来源版本和持久操作回执，让不同入口协作于同一份数据。React 与 CodeMirror 承载写作界面，受限的沙箱桥接负责原生操作。

数据保存在本地。外部 Agent 只能通过授权工具请求相应资料；其模型服务设置仍由你连接的宿主管理。工具准备了哪些引用可以追溯，这不代表捕获模型的私有思考，也不代表外部任务已经完成。

[架构](docs/ARCHITECTURE.md) · [数据与信任边界](docs/SECURITY.md) · [验证说明](docs/TESTING.md)

## 参与贡献

```sh
npm run check
npm run format:check
npm run build
```

参阅[贡献指南](CONTRIBUTING.md)、[需求](docs/PRD.md)和[文档索引](docs/README.md)。首版聚焦个人本地工作；云端协作、通用聊天、广泛集成与应用执行不在本次范围内。

[MIT 许可证](LICENSE)。平台与本地构建的验证边界见使用指南。
