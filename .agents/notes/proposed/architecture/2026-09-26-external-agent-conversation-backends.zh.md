# Agent Note: External agent conversation backends

Status: proposed

[English](2026-09-26-external-agent-conversation-backends.md) | 中文

## Problem

每个 dsh 会话都运行在一条需要 API 密钥的模型路由上：DeepSeek 适配器和 pi-ai 路由都用部署方提供的凭据认证。已经为 Codex 或 Claude Code 付费的人无法让 dsh 会话使用那份订阅。现有的产品提供者 [`dsh-subagent-codex`](../../../../packages/subagent/subagent-codex/README.zh.md) 与 [`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.zh.md) 通过官方集成和原生登录接入这两个产品，但只作一次性委派：每次调用都是新进程和不可恢复的产品对话，最终答案就是全部载荷。会话无法跨轮次继续一个产品对话、看到它的流式输出，或回答它的审批请求。

[lifecycle team Agent Note](2026-09-26-lifecycle-team.zh.md) 中规划的 lifecycle 团队需要角色 agent 运行在 Codex 和 Claude Code 登录上、由 `agentOptions` 以编程方式派生、在一个工作项步骤期间持续同一个产品对话，并且能在无界面环境下工作。第三方插件家族（`relay-dsh-plugin-codex`、`relay-dsh-plugin-claude`）在 Web profile 上验证了这种架构，但其 peer 范围不含 dsh 0.1.7、依赖 Web 服务器、并改写 dsh 私有内部结构，因此不能成为产品的答案。

## Proposal

新增两个会话后端作为实验性 bundle，各自是注册在 `ctx.llm` 上、拥有独立路由（`codex`、`claude-code`）的纯 `LlmAdapter`。路由指向后端的 dsh Agent 保留普通循环、会话日志、审批和呈现；产品拥有模型上下文、系统提示词、原生工具、技能和沙箱。

每次 `stream()` 调用在绑定到 `options.sessionId` 的产品对话上恰好执行一个产品轮次。适配器从 `options.messages` 中取最后一条 `assistant` 消息之后的连续 `user` 消息作为新用户输入，只发送这段文本；`options.system` 和 `options.tools` 被忽略，因为产品自带这些内容。产品文本和推理以 `text-delta` 与 `reasoning-delta` 块流回；产品执行的命令和修改的文件以单行 `reasoning-delta` 文本写入专用推理块，使持久化的 `assistant/message` 承载活动记录而不引入新的呈现面。设置了 `purpose`（会话标题、压缩）或没有会话的请求运行在临时产品对话上，永不触碰绑定。

绑定是持久的：`codex/thread` 与 `claude-code/session` 作为仅记日志的事件加入 `SessionEventMap`，在产品确认对话后于步骤内追加；每会话投影折叠最新绑定，供下一轮次和 Host 重启后的恢复使用。产品对话已不存在时轮次以 `PRODUCT_CONVERSATION_MISSING` 失败；适配器绝不静默新建替代对话。产品未登录时以 `MISSING_CREDENTIAL` 失败并点名原生登录命令。

在默认的 `permissionMode: bridge` 下审批桥接到 dsh：Codex 的 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval` 和 Claude 的 `canUseTool` 回调变为 `ctx.approval.request` 调用，`allowed-once` 结果接受、其他结果拒绝；Codex 的 `item/tool/requestUserInput` 和 Claude 的 `AskUserQuestion` 变为 `ctx.userQuestions.ask` 调用。没有应答者时请求按今天一次性提供者的方式关闭失败。原生无人值守模式仍可按插件实例选择，同一 profile 可挂载多个命名实例，使交互式 `codex` 路由与无人值守 `codex-unattended` 路由并存。

登录保持原生。bundle 安装固定版本的官方运行时，首个请求前不启动任何产品；使用者事先用 `codex login` 或 `claude` 登录。

### Package topology

| 包 | 角色 | 依赖 |
|---|---|---|
| `packages/product-runtime/codex-app-server`（`@deepseek-ai/dsh-codex-app-server`，release） | `@openai/codex` 的唯一固定版本；一次性提供者与后端共用的 app-server 协议客户端：握手、线程启动与恢复、带观察者的轮次执行、中断、模型与账号查询、可注入的服务端请求处理器 | `dsh-sdk-protocol`、`dsh-subprocess` |
| `packages/product-runtime/claude-agent-sdk`（`@deepseek-ai/dsh-claude-agent-sdk`，release） | `@anthropic-ai/claude-agent-sdk` 的唯一固定版本；提供者与后端共用的派生适配器、权限模式词表、释放逻辑和官方 `query` 入口 | `dsh-subprocess` |
| `packages/subagent/subagent-codex`、`packages/subagent/subagent-claude-code`（现有） | 行为不变的一次性提供者，改为消费运行时包 | 运行时包 |
| `packages/experimental/llm-product-backend` | 共享桥接库：新输入推导、临时请求分类、审批与提问桥接、活动行、块发射 | `dsh-llm`、`dsh-agent`、`dsh-user-approval`、`dsh-user-questions` |
| `packages/experimental/llm-codex`（bundle） | `codex` 适配器插件、`codex/thread` 事件与投影、一行 Web 预设 | codex-app-server、llm-product-backend |
| `packages/experimental/llm-claude-code`（bundle） | `claude-code` 适配器插件、`claude-code/session` 事件与投影、一行 Web 预设 | claude-agent-sdk、llm-product-backend |

运行时包是 release 包，因为实验性包可以依赖 release 包而不能反过来。bundle 通过 `dsh plugin --profile <name> add` 安装，而不进入 `OPTIONAL_BUNDLES`，因为每个产品载荷远超可选 bundle 列表所接纳的体积。

### Process lifecycle

Codex：每个插件实例一个 app-server，首个请求时通过 `ctx.subprocess.spawn` 懒启动，随插件释放；每个会话一个线程，以会话的 `cwd` 创建，重启后用 `thread/resume` 恢复；中止时发 `turn/interrupt`；轮次中途退出的服务器使该轮次失败，下一轮次重新启动并恢复。Claude Code：每轮次一次 `query()`，`resume` 设为绑定的会话 id 且 `persistSession: true`，通过每轮次的 `AbortController` 取消，进程归属与一次性提供者相同。

### Configuration

两个插件都校验一张 `routes` 表（路由名 → `permissionMode`，原生模式加 `bridge`，默认一条以产品命名的桥接路由）、`env`、`disposeGraceMs` 与 `turnIdleTimeoutMs`；一个插件实例服务其产品的全部路由。Codex 目录来自共享 app-server 上的 `model/list`；Claude Code 目录来自一次短暂 SDK 查询上的 `supportedModels()`，包含每个模型的力度等级，因此两个插件都不携带 `models` 或 `efforts` 表。两者都没有 `model` 字段：模型是每个 Agent 的 `AgentOptions.model`，由 Web 目录、`agent-default-model` 或派生它的父级选择。

## Alternatives considered

**采用 Relay 插件。** 它们验证了架构，但 peer 范围不含 dsh 0.1.7、注入 Web 服务器、通过写入 profile 主目录注册预设，并通过改写 `KNOWN_SESSION_EVENT_TYPES` 扩展持久化词表。它们只能留在外部、未经审计，且无法在无界面环境使用。

**经 pi-ai OAuth 的仅模型路由。** `openai-codex` 路由可让 dsh 自己的循环和工具运行在 Codex 登录上，但会失去产品的原生工具和技能，而 Anthropic 的条款不允许在 Claude Code 之外使用等价的 Claude 路由。

**拦截 `llm/stream` 而不注册适配器。** 该瀑布让插件为选定会话服务请求而无需拥有路由，但模型选择界面、目录和 `agent-default-model` 都以路由为语言；适配器是模型提供者的既定接缝，且无需改动循环。

**为后端会话跳过提示词组装的新 agent-loop 接缝。** 它可避免组装产品会忽略的系统提示词和工具 schema，但为一个消费者改动循环；最小 Web 预设去掉工具，适配器忽略其余部分，代价可忽略。

**把 wire 和派生代码复制进实验性包。** 不改任何 release 包，但每个产品运行时会有两处固定版本和两份协议代码而漂移；共享运行时包保持一处固定版本和一份实现。

**每会话一个长寿命流式 Claude 查询。** 流式输入支持轮次中途中断，但每轮次一次带 `resume` 的查询对应适配器"每次调用一次尝试"的契约，复用一次性提供者的进程归属，并使重启恢复成为同一机制。

## Acceptance criteria

- `agent-default-model` 设为 `codex` 或 `claude-code` 且产品已登录时，无界面运行在同一个产品对话上完成两个轮次，第二个产品请求携带第一轮的历史。
- 重启 Host 并恢复会话后通过 `thread/resume` 或 `resume` 继续同一个产品对话；缺失的产品对话使轮次以 `PRODUCT_CONVERSATION_MISSING` 失败。
- `bridge` 模式下产品审批请求在会话日志中产生 `approval/asked` 和 `approval/decided`，`rejected` 结果拒绝产品动作。
- 中止轮次会请 Codex 中断其轮次（或取消 Claude Code 查询）并将请求结算为 `aborted`；被拒绝的 Codex 审批拒绝该动作以让轮次继续，只有取消提示才取消轮次。
- 一次性提供者在消费运行时包后保持行为和测试不变，每个产品运行时恰在一个包中固定版本。
- 每个 bundle 在 headless profile 上的 Loader 组合注册路由且不启动产品进程；预设行在 `web` 与 `desktop` profile 之外被禁用，使 headless 启动不产生警告。
- 两个后端都具备单元、无密钥真实产品（经真实 agent 循环驱动）、Loader 组合和带凭据四个层级。录制会话快照延期：产品每次运行分配对话 id，因此在快照规范化器认识产品对话 id 之前，已绑定的 Session 无法确定性重放；SDK 投影无需改动，因为 SDK 场景从不运行后端路由。

## Risks

**Wire 与 SDK 字段名。** 线程恢复参数、推理投入字段、接受决定字面量和 `AskUserQuestion` 应答机制在编写请求构造器前对照固定版本运行时核实；不匹配会在无密钥真实产品层级暴露。

**辅助模型调用消耗产品轮次。** 会话标题和压缩运行在临时产品对话上；认为浪费的部署可为后端会话禁用 `session-title-llm`。

**没有应答者的产品审批。** 无界面组合会把每个桥接审批关闭失败。无人值守工作在单独的命名实例上选择原生模式。

**活动以推理文本呈现。** 把命令和文件变更呈现为推理行让 v1 无需新呈现面，但 Web 卡片和类型化活动事件是更好的长期形式，暂缓实现。

**登录前的 Web 目录。** Codex 目录需要运行中的服务器和登录；`codex login` 完成前 Web 模型列表显示提供者失败。
