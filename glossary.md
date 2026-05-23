# 术语表（Glossary）

本书术语以本文件为准。同一概念全书只用一种译法。首次出现格式："中文（English, 缩写）"，后续使用简称。

---

## A

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 人工智能 | Artificial Intelligence | AI | — |
| 通用人工智能 | Artificial General Intelligence | AGI | 具备跨领域通用智能的 AI 系统 |
| Agent 间通信协议 | Agent-to-Agent Protocol | A2A | Google 提出的 Agent 间通信标准 |
| 自主智能体 | Autonomous Agent | — | 能在无人类干预下独立完成任务的 Agent |
| 审计日志 | Audit Log | — | 记录 Agent 每个决策和操作的可追溯日志 |

## B

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 批处理接口 | Batch API | — | 离线批量处理请求的 API，成本更低但延迟更高 |

## C

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 链 | Chain | — | LangChain 中将多个组件串联的执行单元 |
| 宪法 AI | Constitutional AI | CAI | Anthropic 提出的对齐方法，让模型自我批评和修正 |
| 上下文窗口 | Context Window | — | LLM 单次能处理的最大 Token 数量 |

## D

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 直接偏好优化 | Direct Preference Optimization | DPO | 绕过奖励模型直接优化偏好的对齐方法 |
| 去中心化身份 | Decentralized Identifier | DID | 可验证的去中心化身份标识标准 |
| 纵深防御 | Defense in Depth | — | 多层安全防护策略 |
| 分布外 | Out-of-Distribution | OOD | 模型在训练数据覆盖范围之外的输入上表现下降 |

## E

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 具身智能 | Embodied Intelligence | — | 让 Agent 拥有物理形态，感知和操作物理世界 |
| 精确缓存 | Exact Cache | — | 对完全相同的请求返回缓存结果 |

## F

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 函数调用 | Function Calling | — | LLM 通过结构化协议调用外部工具的机制 |
| 少样本提示 | Few-Shot Prompting | — | 在提示词中提供少量示例引导模型输出 |

## G

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 图 | Graph | — | LangGraph 中定义 Agent 执行流程的核心数据结构 |
| 生成式预训练 Transformer | Generative Pre-trained Transformer | GPT | OpenAI 的 LLM 系列架构 |

## H

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 人在环中 | Human-in-the-Loop | HITL | 关键决策节点需要人类确认的协作模式 |

## I

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 智能即服务 | Intelligence as a Service | IaaS | Agent 将能力以 API 形式对外开放的商业模式 |

## J

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 联合嵌入预测架构 | Joint Embedding Predictive Architecture | JEPA | Yann LeCun 提出的世界模型架构 |

## K

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| KL 散度 | Kullback-Leibler Divergence | KL | 衡量两个概率分布差异的指标，RLHF 中用于约束模型不偏离太远 |

## L

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 大语言模型 | Large Language Model | LLM | 基于 Transformer 的大规模预训练语言模型 |
| LangChain 表达式语言 | LangChain Expression Language | LCEL | LangChain 中用管道符串联组件的声明式语法 |

## M

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 模型上下文协议 | Model Context Protocol | MCP | Anthropic 提出的 Agent 与外部工具交互的开放协议 |
| 最小可用产品 | Minimum Viable Product | MVP | 用最小成本验证核心假设的产品版本 |
| 模型级联 | Model Cascading | — | 根据任务难度选择不同规模模型的策略 |

## N

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 自然语言理解 | Natural Language Understanding | NLU | 让机器理解自然语言意图和实体的技术 |
| 神经符号 | Neuro-Symbolic | — | 结合神经网络学习能力和符号系统推理能力的路径 |

## O

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 开放容器倡议 | Open Container Initiative | OCI | 容器运行时标准，类比 Agent Protocol 的定位 |
| 输出过滤 | Output Filtering | — | Agent 输出面向用户前的安全审查层 |

## P

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 提示词 | Prompt | — | 输入给 LLM 的指令和上下文 |
| 提示词注入 | Prompt Injection | — | 攻击者通过构造输入篡改 Agent 原始指令的安全威胁 |
| 提示词模板 | Prompt Template | — | 包含变量占位符的提示词结构化定义 |
| 近端策略优化 | Proximal Policy Optimization | PPO | RLHF 中用于优化语言模型策略的强化学习算法 |
| 产品-市场契合 | Product-Market Fit | PMF | 产品满足市场需求的验证点 |
| 最小权限原则 | Principle of Least Privilege | PoLP | 每个主体只拥有完成任务所需的最少权限 |

## R

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 推理 + 行动 | Reasoning + Acting | ReAct | 交替进行推理和行动的 Agent 范式 |
| 检索增强生成 | Retrieval-Augmented Generation | RAG | 通过检索外部知识增强 LLM 生成质量的技术 |
| 奖励黑客 | Reward Hacking | — | 模型利用奖励模型缺陷获得高分但实际质量下降的现象 |
| 基于人类反馈的强化学习 | Reinforcement Learning from Human Feedback | RLHF | 用人类偏好数据训练奖励模型来对齐 LLM 的方法 |
| 请求级日志 | Request Log | — | 记录每次 Agent 请求的输入输出摘要 |
| 限流 | Rate Limiting | — | API 服务对单位时间内请求次数的限制 |

## S

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 系统提示词 | System Prompt | — | 定义 Agent 身份、行为规范和约束的顶层指令 |
| 语义缓存 | Semantic Cache | — | 对语义相似的请求返回缓存结果 |
| 安全边界 | Safety Bounds | — | Agent 自主行为的权限和约束边界 |
| 自我反思 | Self-Reflection | — | Agent 评估自身输出质量并自我纠正的能力 |
| 监督微调 | Supervised Fine-Tuning | SFT | 用人工标注数据微调预训练模型 |
| 服务器发送事件 | Server-Sent Events | SSE | 服务端单向推送的轻量实时通信协议 |
| 软件即服务 | Software as a Service | SaaS | 通过互联网提供软件的商业模式 |
| 步骤级日志 | Step Log | — | 记录 Agent 每个步骤的输入输出和工具调用详情 |
| 跨度 | Span | — | 分布式追踪中一个步骤的记录单元 |
| 追踪 | Trace | — | 一次完整 Agent 请求的所有步骤串联记录 |

## T

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 工具调用 | Tool Calling | — | Agent 通过 Function Calling 协议调用外部工具 |
| 工具使用 | Tool Use | — | Agent 使用外部工具扩展能力边界的通用概念 |
| 首 Token 时间 | Time to First Token | TTFT | 从发出请求到收到第一个 Token 的延迟指标 |

## W

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 世界模型 | World Model | — | Agent 在内部模拟物理世界运行以预测行动后果的模型 |

## 数字与符号

| 术语 | 英文 | 缩写 | 说明 |
|------|------|------|------|
| 人造 Agent | Wizard of Oz | — | 用户以为在和 Agent 交互，实际背后是人工操作 |
