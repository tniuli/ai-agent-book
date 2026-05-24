# 第17章 Agent 调试方法论

> 图难于其易，为大于其细。——《道德经》

如果你写过传统软件，调试的流程大致是这样的：设断点、看变量、查堆栈、改代码——一套组合拳下来，问题基本水落石出。但当你开始调试一个 Agent 时，你会发现这套方法论突然不太管用了。同样的输入产生不同的输出，多步骤链条中任何一环出错都可能导致最终失败，而外部工具的不可控性更让问题雪上加霜。本章将帮你理解 Agent 调试的根本困难，掌握三层日志设计（请求级、步骤级、细节级）和结构化日志实践，学会用 LangSmith trace 分析定位问题，并掌握成本监控、幻觉处理、性能优化等常见问题的排查策略。

## 17.1 为什么 Agent 调试这么难

如果你写过传统软件，调试的流程大致是这样的：设断点、看变量、查堆栈、改代码——一套组合拳下来，问题基本水落石出。但当你开始调试一个 Agent 时，你会发现这套方法论突然不太管用了。为什么？

### 17.1.1 非确定性：同样的输入，不同的输出

传统程序是确定性的——给定相同的输入，必定得到相同的输出。但 Agent 的核心是 LLM（Large Language Model，大语言模型），LLM 本质上是一个概率模型。你问它同样的问题，它可能给出完全不同的回答，甚至选择不同的工具。

这种非确定性带来的调试困难是根本性的：

- **难以复现**：用户报告了一个 Bug，你本地一跑，没问题。再跑一次，还是没问题。等到第十次，终于复现了——但你不知道是哪个环节的随机性导致的。
- **难以回归测试**：你修复了一个问题，写了个测试用例来验证。但下次跑的时候，Agent 走了另一条路径，你的测试用例根本没覆盖到。
- **难以 A/B 对比**：你想对比两个提示词的效果，但每次运行的随机性让对比变得像在风中量温度。

### 17.1.2 长链条：一次请求可能经历十几个环节

一个典型的 Agent 请求可能经历这样的流程：

```
用户输入 → 意图识别 → 提示词组装 → LLM 推理 → 工具选择 → 工具执行
→ 结果解析 → 下一步决策 → LLM 推理 → 另一个工具 → 结果整合 → 最终回答
```

这条链上任何一个环节出问题，最终表现都是"Agent 回答错了"。但你很难一眼看出是哪个环节出了问题：

- 是意图识别把用户的意思理解错了？
- 是提示词组装时丢掉了关键上下文？
- 是 LLM 推理时产生了幻觉？
- 是工具选择时选错了工具？
- 是工具执行时返回了异常数据？
- 是结果解析时格式解析失败？

就像一条流水线，最终产品不合格，你得从第一道工序开始逐一排查。

### 17.1.3 隐式状态：Agent 的"思考过程"是黑盒

传统程序的状态存在变量里，你可以随时查看。但 Agent 的"状态"主要存在于 LLM 的上下文窗口中——那是一段长长的对话历史和提示词。你不能像查看变量一样查看 Agent 的"思考状态"，只能从它的输出来推断。

更麻烦的是，Agent 的记忆（Memory）机制往往也是隐式的。长期记忆存在向量数据库里，短期记忆存在对话历史中，工作记忆存在提示词模板的变量里。这些记忆的检索和组装过程，几乎都是黑盒。

### 17.1.4 工具交互：外部系统的不确定性

Agent 不是孤立的系统，它需要和外部世界交互——调用 API、查数据库、读文件、发邮件。这些外部系统本身就可能不稳定：

- API 超时或返回错误
- 数据库中的数据发生变化
- 网络延迟导致工具执行时间不确定
- 第三方服务的限流（Rate Limiting）

当 Agent 的行为异常时，你需要区分：是 Agent 自身的问题，还是外部系统的问题？

### 17.1.5 一个直观的例子

假设你有一个客服 Agent，用户问"我的订单什么时候发货"，Agent 回答"您的订单已取消"。你一看就知道出了问题，但原因可能是：

1. **意图识别错误**：Agent 把"什么时候发货"理解成了"取消订单"
2. **工具调用错误**：Agent 调了查订单的工具，但传错了参数，查到了别人的订单
3. **数据解析错误**：工具返回的状态码是"shipped"，但 Agent 把它解析成了"cancelled"
4. **上下文混淆**：对话历史中有另一条关于取消订单的讨论，Agent 把上下文混淆了
5. **模型幻觉**：LLM 凭空"编造"了一个取消的结果

没有良好的调试基础设施，你根本无从区分这五种情况。

---

## 17.2 日志追踪设计

既然 Agent 调试这么难，我们首先要建立的就是"可观测性"（Observability）。日志追踪是可观测性的基础，也是最朴素、最有效的方法。

这里需要避开一个常见的实践误区：用 `print` 调试 Agent 几乎不可行。Agent 的多步执行意味着输出太多时找不到关键信息，输出太少又遗漏问题线索；另一个极端是记录所有内容（包括完整的 LLM 响应和工具返回），导致日志膨胀、成本飙升。合理的做法是采用三层日志架构——默认只记录请求级和步骤级，细节级按需开启；所有日志统一输出为 JSON 格式，方便后续搜索和聚合。下面我们就来设计这套三层日志体系。

### 17.2.1 日志的三个层次

在设计 Agent 的日志系统时，我建议采用三层日志结构：

**第一层：请求级日志（Request Log）**

记录每次 Agent 请求的元信息：

```python
@dataclass
class RequestLog:
    request_id: str          # 唯一请求 ID
    user_id: str             # 用户 ID
    timestamp: str           # 请求时间
    input_message: str       # 用户输入
    final_output: str        # 最终输出
    total_tokens: int        # 总 Token 用量
    total_cost: float        # 总成本
    duration_ms: int         # 总耗时
    status: str              # 成功/失败
    error_message: str | None  # 错误信息
```

**第二层：步骤级日志（Step Log）**

记录 Agent 执行每一步的信息：

```python
@dataclass
class StepLog:
    request_id: str          # 关联的请求 ID
    step_index: int          # 步骤序号
    step_type: str           # 步骤类型：llm_call / tool_call / tool_result
    input_data: dict         # 步骤输入
    output_data: dict        # 步骤输出
    duration_ms: int         # 步骤耗时
    token_usage: dict | None # Token 用量（仅 LLM 调用）
    model_name: str | None   # 模型名称（仅 LLM 调用）
    tool_name: str | None    # 工具名称（仅工具调用）
```

**第三层：细节级日志（Detail Log）**

记录最细粒度的信息，用于深入排查：

```python
@dataclass
class DetailLog:
    request_id: str
    step_index: int
    detail_type: str         # prompt_template / full_context / raw_response / parse_error
    content: str             # 详细内容
```

### 17.2.2 日志设计原则

设计 Agent 日志系统时，有几条关键原则：

**原则一：结构化优先**

不要用 `print(f"调用工具 {tool_name}")` 这种非结构化日志。所有日志都应该是结构化的（JSON 或 dataclass），这样才能被机器解析、搜索和聚合。

**原则二：关联 ID 贯穿始终**

每个请求都有一个唯一的 `request_id`，所有层级的日志都通过这个 ID 关联。这样你可以通过一个 `request_id` 把请求级、步骤级、细节级的日志全部串起来。

**原则三：记录耗时和 Token**

Agent 的两个核心指标是耗时和 Token 用量。每一步都要记录这两个指标，这样你才能定位是哪一步慢、哪一步费钱。

**原则四：日志级别可控**

细节级日志数据量很大（包含完整的提示词和上下文），不应该在生产环境默认开启。设计一个日志级别机制：

```python
class LogLevel(Enum):
    REQUEST = "request"      # 只记录请求级
    STEP = "step"            # 记录到步骤级
    DETAIL = "detail"        # 记录到细节级（调试模式）
```

**原则五：敏感信息脱敏**

Agent 的日志中可能包含用户的个人信息、API Key 等。设计日志时要考虑脱敏：

```python
def mask_sensitive(data: dict) -> dict:
    """对敏感字段进行脱敏处理"""
    sensitive_keys = {"api_key", "password", "token", "secret"}
    return {
        k: "***MASKED***" if k in sensitive_keys else v
        for k, v in data.items()
    }
```

### 17.2.3 一个轻量级日志追踪器

下面我们实现一个可以直接集成到任何 Agent 中的日志追踪器。这个追踪器不需要依赖任何外部服务，开箱即用：

```python
# tracer.py 中的核心类将放在 17.7 实战部分
# 这里展示设计思路
```

### 17.2.4 日志与 Trace 的关系

你可能听说过"分布式追踪"（Distributed Tracing）这个概念。在微服务架构中，Trace 用来追踪一个请求在多个服务之间的调用链路。Agent 的日志追踪本质上也是 Trace——只不过调用链路不是跨服务的，而是在 Agent 内部的多个步骤之间。

一个完整的 Trace 包含：

- **Trace**：一次完整的 Agent 请求
- **Span**：Trace 中的一个步骤（LLM 调用、工具调用等）
- **Attribute**：Span 上的附加信息（模型名、Token 数等）

这个概念和 OpenTelemetry 的 Trace/Span 模型是一致的，后面我们会看到 LangSmith 也是基于这个模型设计的。

---

## 17.3 LangSmith trace 分析实战

LangSmith 是 LangChain 团队推出的 Agent 可观测性平台，它提供了强大的 Trace 可视化和分析功能。即使你不使用 LangChain，LangSmith 也值得了解——因为它代表了 Agent 调试工具的设计范式。

### 17.3.1 LangSmith 的核心概念

LangSmith 的数据模型和我们上面设计的三层日志结构高度吻合：

- **Trace**：对应一次完整的 Agent 运行，等价于我们的 RequestLog
- **Run**：对应 Trace 中的一个步骤，等价于我们的 StepLog。Run 之间有树形的父子关系
- **Feedback**：用户对运行结果的评价，可以用来做质量评估

```
Trace (一次 Agent 请求)
├── Run: ChainExecutor
│   ├── Run: LLM Call (意图识别)
│   │   └── Token Usage: input=150, output=30
│   ├── Run: Tool Call (查询数据库)
│   │   └── Duration: 1200ms
│   ├── Run: LLM Call (生成回答)
│   │   └── Token Usage: input=500, output=200
│   └── Run: Output Parser
```

### 17.3.2 接入 LangSmith

接入 LangSmith 非常简单，只需要设置环境变量：

```bash
export LANGCHAIN_TRACING_V2="true"
export LANGCHAIN_API_KEY="your-api-key"
export LANGCHAIN_PROJECT="my-agent-project"
```

设置之后，所有使用 LangChain 的 Agent 运行都会自动上报 Trace 到 LangSmith。

如果你不使用 LangChain，也可以通过 SDK 手动上报：

```python
from langsmith.run_helpers import traceable

@traceable(run_type="llm", name="intent_recognition")
def recognize_intent(user_input: str) -> str:
    # 你的意图识别逻辑
    response = openai.ChatCompletion.create(...)
    return response.choices[0].message.content
```

### 17.3.3 在 LangSmith 中分析 Trace

当你的 Agent 运行结果出现问题时，在 LangSmith 中排查的步骤是：

**第一步：查看 Trace 列表**

在 LangSmith 的项目页面，你可以看到所有 Trace 的列表。列表中显示了每次运行的输入、输出、耗时、Token 用量和状态。你可以按时间、状态、Token 用量等排序，快速定位异常的 Trace。

**第二步：展开 Run 树**

点击一个 Trace，你可以看到它的 Run 树——这就是 Agent 的完整执行过程。每个 Run 节点显示了类型、耗时、Token 用量。如果某个 Run 的耗时特别长或 Token 用量特别多，它就是你的排查重点。

**第三步：检查输入输出**

点击具体的 Run 节点，你可以查看它的输入和输出。这是排查问题最关键的一步——你可以逐环节检查，到底是哪一步出了问题。

**第四步：检查 Prompt**

对于 LLM 调用的 Run，你可以查看发送给 LLM 的完整 Prompt。这是调试提示词问题的重要手段——很多时候，问题出在 Prompt 的组装上，而不是 LLM 本身。

### 17.3.4 LangSmith 的高级功能

**对比分析**：LangSmith 支持选择两个 Trace 进行对比。当你修改了提示词或参数后，可以让 Agent 运行同样的输入，然后对比两次运行的 Trace，直观地看到差异。

**标签和过滤**：你可以给 Trace 打标签（如 `production`、`experiment-v2`），然后按标签过滤。这对于 A/B 测试特别有用。

**自动评估**：LangSmith 支持配置自动评估器（Evaluator），对每次运行的结果进行自动打分。这可以帮你快速发现质量退化的 Trace。

**会话分析**：LangSmith 按会话（Session）组织 Trace，你可以查看一个用户的完整对话历史和所有相关 Trace。

---

## 17.4 逐步回放（Replay）

调试的本质是什么？是让问题"可复现"。传统程序的断点调试之所以有效，就是因为你可以精确地让程序在某个状态停下来，检查所有变量。Agent 调试也需要类似的能力——逐步回放。

### 17.4.1 什么是 Replay

Replay 是指记录 Agent 运行的完整过程，然后在需要时逐步回放这个过程。它不是简单的日志回看，而是让 Agent 的每一步都可以被"还原"和"检查"。

一个完整的 Replay 系统需要记录：

1. **每一步的输入**：发送给 LLM 的完整 Prompt、传给工具的参数
2. **每一步的输出**：LLM 的完整回复、工具的返回结果
3. **每一步的状态**：Agent 在这一步的内部状态（记忆、上下文等）
4. **每一步的决策依据**：为什么选了这个工具而不是那个？为什么走了这条路径？

### 17.4.2 LangGraph 的 Replay 能力

LangGraph 内置了强大的 Replay 能力，这是它相比其他 Agent 框架的一个显著优势。

LangGraph 的状态机设计天然支持 Replay——因为每个节点执行后，状态会被持久化到检查点（Checkpoint）中。你可以从任何一个检查点恢复执行，也可以查看每一步的完整状态。

```python
from langgraph.checkpoint.memory import MemorySaver

# 使用内存检查点
checkpointer = MemorySaver()

# 创建带检查点的 Agent
app = create_react_agent(model, tools, checkpointer=checkpointer)

# 运行 Agent
config = {"configurable": {"thread_id": "thread-1"}}
result = app.invoke({"messages": [("user", "你好")]}, config)

# 回放：查看所有检查点
states = list(app.get_state_history(config))
for state in states:
    print(f"步骤 {state.metadata['step']}: {state.values}")
```

### 17.4.3 从任意节点重新执行

LangGraph 的 Replay 最强大的功能是"时光机"——你可以修改历史状态，然后从某个节点重新执行。

```python
# 获取最新状态
latest_state = app.get_state(config)

# 回退到第 3 步
for state in app.get_state_history(config):
    if state.metadata["step"] == 3:
        # 从第 3 步重新执行
        app.update_state(config, state.values, as_node="agent")
        break

# 重新执行
result = app.invoke(None, config)
```

这个功能在调试时非常有用。比如你发现 Agent 在第 5 步选错了工具，你可以回退到第 4 步，修改提示词，然后重新执行，看 Agent 是否会做出不同的选择。

### 17.4.4 自建 Replay 系统

如果你不使用 LangGraph，也可以自建 Replay 系统。核心思路是：在 Agent 的每个决策点，记录完整的"快照"。

```python
import json
from datetime import datetime

class ReplayRecorder:
    def __init__(self, request_id: str):
        self.request_id = request_id
        self.snapshots = []

    def record_snapshot(self, step: int, node_name: str,
                       input_data: dict, output_data: dict,
                       state: dict):
        """记录一个步骤的快照"""
        snapshot = {
            "request_id": self.request_id,
            "step": step,
            "node_name": node_name,
            "timestamp": datetime.now().isoformat(),
            "input_data": input_data,
            "output_data": output_data,
            "state_snapshot": state,
        }
        self.snapshots.append(snapshot)

    def save(self, filepath: str):
        """保存快照到文件"""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(self.snapshots, f, ensure_ascii=False, indent=2)

    def replay(self, filepath: str):
        """从文件加载并回放"""
        with open(filepath, "r", encoding="utf-8") as f:
            snapshots = json.load(f)
        for snapshot in snapshots:
            print(f"=== 步骤 {snapshot['step']}: {snapshot['node_name']} ===")
            print(f"输入: {json.dumps(snapshot['input_data'], ensure_ascii=False)[:200]}")
            print(f"输出: {json.dumps(snapshot['output_data'], ensure_ascii=False)[:200]}")
            print()
```

### 17.4.5 Replay 的注意事项

**存储开销**：完整快照的数据量很大，尤其当上下文窗口很长时。考虑增量存储——只记录每步的变化部分，而不是完整状态。

**敏感数据**：Replay 记录中可能包含用户的敏感信息。如果需要将 Replay 数据用于离线分析或分享给团队，务必做好脱敏处理。

**时间旅行悖论**：修改历史状态后重新执行，可能导致"蝴蝶效应"——微小的变化引起后续步骤的巨大差异。这是 LLM 非确定性的固有特性，使用时要有心理准备。

---

## 17.5 成本监控与 Token 用量

Agent 不是免费的。每次 LLM 调用都在消耗 Token，而 Token 就是钱。如果不做好成本监控，你的 Agent 可能会在你不知不觉中烧光预算。

### 17.5.1 Token 用量的构成

一个 Agent 的 Token 用量主要由以下几部分构成：

| 组成部分 | 说明 | 占比（典型场景） |
|---------|------|----------------|
| 系统提示词 | Agent 的角色定义、行为规范 | 5-15% |
| 对话历史 | 之前轮次的对话记录 | 20-50% |
| 工具描述 | 所有可用工具的说明文档 | 5-10% |
| 工具结果 | 工具执行后返回的数据 | 10-30% |
| LLM 输出 | Agent 生成的回复 | 10-20% |

从这个表可以看出，对话历史和工具结果往往占据了大部分 Token。这意味着：

- **长对话特别费钱**：因为每轮对话都要把之前的所有对话历史发给 LLM
- **工具返回数据量大的特别费钱**：如果工具返回了一整篇文档，这些 Token 全都要计入

### 17.5.2 Token 计费模型

主流 LLM 的计费模型是按 Token 分别计费：

| 模型 | 输入价格 | 输出价格 | 备注 |
|------|---------|---------|------|
| GPT-4o | $2.50/1M | $10.00/1M | 2025 年价格 |
| Claude Sonnet | $3.00/1M | $15.00/1M | 2025 年价格 |
| DeepSeek V3 | $0.27/1M | $1.10/1M | 2025 年价格 |

注意输出 Token 的价格通常是输入 Token 的 3-5 倍！这意味着 Agent 的"话多"比"听多"更费钱。如果你的 Agent 动不动就长篇大论，成本会急剧上升。

### 17.5.3 成本监控实现

一个实用的成本监控器需要做到：

1. 实时追踪每次 LLM 调用的 Token 用量
2. 按模型、按步骤、按请求聚合成本
3. 设置预算告警
4. 提供成本分析报告

```python
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class TokenRecord:
    """单次 LLM 调用的 Token 记录"""
    request_id: str
    step_index: int
    model_name: str
    input_tokens: int
    output_tokens: int
    timestamp: datetime

@dataclass
class CostConfig:
    """模型计费配置"""
    prices: dict = field(default_factory=lambda: {
        "gpt-4o": {"input": 2.50 / 1_000_000, "output": 10.00 / 1_000_000},
        "gpt-4o-mini": {"input": 0.15 / 1_000_000, "output": 0.60 / 1_000_000},
        "claude-sonnet": {"input": 3.00 / 1_000_000, "output": 15.00 / 1_000_000},
    })

class CostMonitor:
    def __init__(self, config: CostConfig | None = None,
                 budget_limit: float | None = None):
        self.config = config or CostConfig()
        self.budget_limit = budget_limit
        self.records: list[TokenRecord] = []

    def record(self, record: TokenRecord):
        """记录一次 Token 使用"""
        self.records.append(record)
        if self.budget_limit:
            total = self.get_total_cost()
            if total > self.budget_limit * 0.8:
                print(f"⚠️ 成本告警：已使用 {total:.4f} 美元，"
                      f"超过预算 {self.budget_limit} 的 80%")
            if total > self.budget_limit:
                raise RuntimeError(f"超出预算限制 {self.budget_limit} 美元")

    def get_total_cost(self) -> float:
        """计算总成本"""
        total = 0.0
        for r in self.records:
            prices = self.config.prices.get(r.model_name, {})
            input_cost = r.input_tokens * prices.get("input", 0)
            output_cost = r.output_tokens * prices.get("output", 0)
            total += input_cost + output_cost
        return total

    def get_cost_by_model(self) -> dict:
        """按模型分组统计成本"""
        costs = {}
        for r in self.records:
            if r.model_name not in costs:
                costs[r.model_name] = {"input_cost": 0, "output_cost": 0,
                                        "input_tokens": 0, "output_tokens": 0}
            prices = self.config.prices.get(r.model_name, {})
            costs[r.model_name]["input_cost"] += (
                r.input_tokens * prices.get("input", 0))
            costs[r.model_name]["output_cost"] += (
                r.output_tokens * prices.get("output", 0))
            costs[r.model_name]["input_tokens"] += r.input_tokens
            costs[r.model_name]["output_tokens"] += r.output_tokens
        return costs

    def get_summary(self) -> str:
        """生成成本摘要报告"""
        lines = ["=" * 50, "成本监控报告", "=" * 50]
        by_model = self.get_cost_by_model()
        for model, data in by_model.items():
            total = data["input_cost"] + data["output_cost"]
            lines.append(f"\n模型: {model}")
            lines.append(f"  输入: {data['input_tokens']:,} tokens "
                        f"(${data['input_cost']:.4f})")
            lines.append(f"  输出: {data['output_tokens']:,} tokens "
                        f"(${data['output_cost']:.4f})")
            lines.append(f"  合计: ${total:.4f}")
        lines.append(f"\n总成本: ${self.get_total_cost():.4f}")
        if self.budget_limit:
            lines.append(f"预算: ${self.budget_limit:.2f}")
            lines.append(f"使用率: {self.get_total_cost()/self.budget_limit*100:.1f}%")
        return "\n".join(lines)
```

### 17.5.4 降低成本的策略

了解了成本构成后，我们可以有针对性地降低成本：

**策略一：缩短对话历史**

使用滑动窗口或摘要策略，不要把所有对话历史都发给 LLM。可以只保留最近 N 轮对话，更早的对话用摘要替代。

**策略二：精简工具描述**

工具描述会占用输入 Token。确保每个工具的描述简洁明了，不要写长篇大论的文档。

**策略三：分级模型策略**

不是每一步都需要最强的模型。意图识别可以用小模型，复杂推理才用大模型。这种"分级模型"（Model Cascading）策略可以大幅降低成本。

**策略四：缓存结果**

相同的输入如果已经调用过 LLM，直接返回缓存结果。这在开发调试阶段特别有用。

**策略五：控制输出长度**

设置 `max_tokens` 参数限制输出长度。很多时候 Agent 的输出比需要的长得多。

---

## 17.6 问题定位策略

当 Agent 出现问题时，最关键的一步是"定位问题出在哪里"。根据我的经验，Agent 的问题可以归为四大类：

### 17.6.1 提示词问题

**症状**：
- Agent 的行为不符合预期，但回答本身是"合理的"（只是不是你想要的）
- Agent 做出了错误的选择，但如果看提示词，它的选择是"符合指令"的
- Agent 的回答格式不正确

**排查方法**：
1. 查看发送给 LLM 的完整 Prompt（在细节级日志中）
2. 问自己：如果我是 LLM，看到这个 Prompt，我会怎么回答？
3. 如果 LLM 的回答"符合 Prompt 但不符合预期"，那就是 Prompt 的问题

**常见原因**：
- 角色定义不够清晰
- 缺少必要的约束条件
- Few-shot 示例和期望行为不一致
- 上下文过长导致关键信息被"淹没"

**修复策略**：
- 用更明确的语言描述期望行为
- 添加反面示例（"不要做 X"）
- 使用结构化的输出格式（JSON Schema）
- 缩短上下文，突出关键信息

### 17.6.2 工具问题

**症状**：
- Agent 选择了正确的工具，但结果不对
- Agent 反复调用同一个工具
- Agent 调用了不该调用的工具

**排查方法**：
1. 检查工具的输入参数是否正确
2. 直接调用工具，看返回结果是否正确
3. 检查工具的返回格式是否符合 Agent 的预期

**常见原因**：
- 工具的参数定义不清晰，导致 Agent 传错参数
- 工具返回的数据格式不稳定
- 工具的描述误导了 Agent 的选择
- 工具执行超时或报错，但错误信息不够友好

**修复策略**：
- 精确描述工具的参数类型和格式
- 规范化工具的返回格式
- 添加工具的适用场景和限制说明
- 做好工具的错误处理和超时机制

### 17.6.3 模型问题

**症状**：
- Agent 的推理逻辑出错
- Agent 产生了幻觉（Hallucination）
- Agent 无法理解复杂的指令

**排查方法**：
1. 把同样的 Prompt 发给另一个模型，看是否有同样的问题
2. 简化 Prompt，排除提示词的因素
3. 如果问题只在特定模型上出现，那就是模型的问题

**常见原因**：
- 模型能力不足（小模型处理不了复杂推理）
- 模型的知识过时（训练数据截止日期之前的信息）
- 模型的特定偏见或倾向

**修复策略**：
- 换用更强的模型
- 把复杂任务拆分成简单的子任务
- 在 Prompt 中补充必要的背景知识
- 使用检索增强生成（RAG）提供最新的信息

### 17.6.4 架构问题

**症状**：
- Agent 陷入了死循环
- Agent 在多个步骤之间反复跳转
- Agent 的执行时间远超预期

**排查方法**：
1. 查看 Run 树，分析 Agent 的执行路径
2. 检查状态机的转换条件是否合理
3. 检查是否有循环依赖

**常见原因**：
- 状态机的终止条件设计不当
- 工具之间形成了循环依赖
- 缺少最大步数限制
- 条件分支的逻辑有漏洞

**修复策略**：
- 设置最大步数限制（如最多 10 步）
- 优化状态机的转换条件
- 添加循环检测机制
- 设计明确的终止状态

### 17.6.5 问题定位决策树

当你面对一个 Agent 问题时，可以按照以下决策树逐步排查：

Problem Diagnosis Decision Tree（问题定位决策树）：

```
Agent Behavior Abnormal
│
├─ Check Output
│  ├─ Format Error → Prompt Issue (Output format constraint insufficient)
│  ├─ Content Error → Continue
│  └─ No Output/Error → Check if Tools are working
│
├─ Check Run Tree
│  ├─ Too Many Steps → Architecture Issue (Dead loop or inefficient path)
│  ├─ Wrong Tool Selected → Prompt Issue (Tool selection guidance weak)
│  └─ Tool Result Anomaly → Tool Issue
│
├─ Check LLM Input (Prompt)
│  ├─ Prompt Correct but Output Wrong → Model Issue
│  ├─ Prompt Missing Key Info → Prompt Issue
│  └─ Prompt Contains Wrong Info → Upstream Step Issue
│
└─ Compare Across Models
   ├─ All Models Have Issues → Prompt or Architecture Issue
   └─ Only Specific Model Has Issue → Model Issue
```

这个决策树不是完美的，但它给出了一个系统的排查思路。记住古人说的"病来如山倒，病去如抽丝"——Agent 出问题往往很突然，但定位问题需要逐步排查，不能急躁。

---

## 17.7 实战

理论讲了不少，现在我们来动手。这一节，我们将实现一个完整的 Agent 全链路追踪系统，包括日志记录、Trace 可视化、成本监控和 Replay 回放。

### 17.7.1 系统架构

AgentTracer Architecture（追踪系统架构）：

```
User Request
   │
   ▼
┌─────────────────┐
│  AgentTracer     │ ← Unified Trace Entry
│  ┌─────────────┐ │
│  │ LogStore    │ │ ← Log Storage (JSON File)
│  ├─────────────┤ │
│  │ CostMonitor │ │ ← Cost Monitoring
│  ├─────────────┤ │
│  │ ReplayEngine│ │ ← Replay Engine
│  └─────────────┘ │
└─────────────────┘
   │
   ▼
 Agent Execution
   │
   ▼
Trace Report
```

### 17.7.2 完整代码

请查看同目录下的 `agent_tracer.py` 文件，其中包含完整的全链路追踪实现。`demo_tracer.py` 演示了如何使用这个追踪系统。

### 17.7.3 代码要点解读

**要点一：装饰器模式实现无侵入追踪**

我们使用 Python 装饰器来包装 LLM 调用和工具调用，实现无侵入的追踪：

```python
@tracer.trace_llm(model="gpt-4o")
def call_llm(messages: list) -> str:
    response = openai.ChatCompletion.create(
        model="gpt-4o", messages=messages
    )
    return response.choices[0].message.content

@tracer.trace_tool(name="search_database")
def search_database(query: str) -> dict:
    # 工具实现
    return {"results": [...]}
```

这样，你不需要修改 Agent 的核心逻辑，只需要在函数上加一个装饰器，就自动获得了追踪能力。

**要点二：上下文管理器实现请求级追踪**

对于一次完整的 Agent 请求，我们使用上下文管理器来管理请求的整个生命周期：

```python
with tracer.trace_request(user_id="user-123") as req:
    result = agent.run("帮我查一下订单状态")
    req.set_output(result)
```

**要点三：Trace 报告生成**

每次请求完成后，追踪器自动生成一份 Trace 报告：

```
========== Agent Trace 报告 ==========
请求 ID: req-20240115-001
用户 ID: user-123
状态: 成功
总耗时: 3,250 ms
总成本: $0.0085

步骤详情:
  [1] LLM Call (gpt-4o) - 850ms, 350 tokens in / 80 out
  [2] Tool Call (query_order) - 1,200ms
  [3] LLM Call (gpt-4o) - 1,100ms, 500 tokens in / 150 out
  [4] Output Parser - 50ms

成本分布:
  gpt-4o: $0.0085 (输入: $0.0021, 输出: $0.0064)
=====================================
```

---

## 17.8 进阶拓展

### 17.8.1 从手动追踪到自动追踪

我们这一章实现的追踪系统需要手动添加装饰器。在更成熟的方案中，可以通过以下方式实现自动追踪：

- **Monkey Patching**：自动替换 `openai.ChatCompletion.create` 等函数，无需修改业务代码
- **中间件模式**：在 Agent 框架的中间层插入追踪逻辑
- **OpenTelemetry 集成**：使用 OpenTelemetry 的自动 Instrumentation

### 17.8.2 实时监控面板

将追踪数据推送到时序数据库（如 InfluxDB、Prometheus），配合 Grafana 构建实时监控面板，可以实时看到：

- 每分钟的请求数和成功率
- 平均响应时间和 P99 延迟
- 每小时的 Token 消耗和成本
- 错误率趋势

### 17.8.3 自动化测试与回归检测

基于追踪数据，可以构建自动化测试：

- **Golden Test**：记录一组"黄金"Trace，每次修改后对比新 Trace 和黄金 Trace 的差异
- **回归检测**：自动运行一批测试用例，检测 Agent 的行为是否发生了非预期的变化
- **质量门禁**：在 CI/CD 中设置质量门禁，如果成本超过阈值或成功率低于标准，自动阻止发布

---

## 习题

**习题一（基础）：为你的 Agent 添加三层日志**

选择你之前实现的任意一个 Agent，为其添加三层日志系统。要求：
- 每次请求记录请求级日志
- 每个 LLM 调用和工具调用记录步骤级日志
- 支持通过环境变量控制日志级别
- 日志输出为 JSON 格式

**习题二（进阶）：实现成本监控与告警**

在习题一的基础上，添加成本监控功能。要求：
- 追踪每次 LLM 调用的 Token 用量
- 支持按模型、按日期、按用户统计成本
- 设置日预算上限，超出时发送告警
- 生成每日成本报告

**习题三（挑战）：构建一个简单的 Replay 系统**

实现一个支持逐步回放的 Replay 系统。要求：
- 记录 Agent 每一步的完整状态快照
- 支持从任意步骤回放
- 支持修改历史状态后重新执行
- 对比原始执行和回放执行的差异

## 参考文献

1. LangSmith Documentation. https://docs.smith.langchain.com/
2. Weights & Biases Weave Documentation. https://weave-docs.wandb.ai/
3. Arize AI Phoenix Documentation. https://docs.arize.com/phoenix

## 开放讨论

1. **隐私与调试的平衡**：Agent 的日志中可能包含用户的敏感信息。你如何在保证调试能力的同时保护用户隐私？有没有一种"足够有用但足够安全"的日志粒度？

2. **非确定性的测试策略**：既然 Agent 的输出是非确定性的，传统的"断言输出等于期望值"的测试方法不再适用。你认为应该怎样设计 Agent 的自动化测试？测试"过程"还是测试"结果"？

3. **调试工具的未来**：当前 Agent 调试工具（如 LangSmith）主要还是"事后分析"模式。你认为未来的 Agent 调试工具应该具备什么能力？是否可能出现类似"智能断点"——当 Agent 即将做出错误决策时自动暂停？

---
