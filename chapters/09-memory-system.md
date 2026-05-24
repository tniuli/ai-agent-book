# 第9章 记忆系统——让 Agent 拥有温故知新的能力

> 温故而知新，可以为师矣。——《论语·为政》

一个没有记忆的 Agent，每次对话都从零开始，就像一个永远失忆的人——无法积累经验，无法理解上下文，更无法与用户建立长期关系。记忆系统，就是赋予 Agent"温故"的能力，让它从过去的交互中"知新"。本章将带你理解短期记忆、长期记忆、工作记忆、情景记忆的分类与适用场景，掌握 LangGraph 检查点机制实现对话状态持久化，学会用向量存储 + 语义检索构建长期记忆，并实战构建一个有长期记忆的个人助手。

## 9.1 记忆的分类

在讨论 Agent 的记忆之前，我们先回到人类自身。人的记忆并非铁板一块，而是由多种不同类型的记忆协同工作。理解人类记忆的分类，是设计 Agent 记忆系统的理论基础。

不过要提前说明的是，长期记忆的语义检索并非万能。当用户的问题与存储内容的语义距离较远（比如用户问"推荐晚餐"但存储的是"喜欢吃辣"），检索可能返回完全无关的记忆条目，反而干扰 LLM 的判断。更危险的是上下文窗口溢出——如果检索返回的文档片段过多或过长，加上对话历史后超出 LLM 的窗口限制，Agent 会截断或崩溃。所以实际构建时需要为检索结果设置相似度阈值（低于阈值的直接丢弃），限制返回的 Top-K 数量和单条记忆的最大长度，并在拼接上下文前计算总 token 数、超出预算时按优先级裁剪。

### 9.1.1 人类记忆的启发

认知心理学将人类记忆分为以下几类：

- **短期记忆（Short-term Memory）**：容量有限，通常只能保持 7±2 个信息单元，持续时间约 15-30 秒。你在心里默念一串电话号码时，用的就是短期记忆。
- **工作记忆（Working Memory）**：短期记忆的"升级版"，不仅存储信息，还在大脑中对信息进行加工处理。你在心算"23 × 17"时，既要记住数字，又要进行运算，这就是工作记忆。
- **长期记忆（Long-term Memory）**：容量几乎无限，可以持续数年甚至终生。你记得自己的名字、家乡、专业技能，这些都存储在长期记忆中。长期记忆又分为：
  - **陈述性记忆（Declarative Memory）**：可以明确表述的事实和事件，比如"巴黎是法国的首都"
  - **程序性记忆（Procedural Memory）**：如何做某事的技能，比如骑自行车、打字
- **情景记忆（Episodic Memory）**：长期记忆的一个子类，记录特定时间发生的具体事件，比如"2024年春节我在老家放烟花"

### 9.1.2 Agent 记忆的对应关系

将人类记忆模型映射到 Agent 世界，我们得到如下对应关系：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Agent 记忆分类体系                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐     ┌─────────────────────┐               │
│  │    短期记忆 STM      │     │   长期记忆 LTM       │               │
│  │  Short-term Memory  │     │  Long-term Memory   │               │
│  ├─────────────────────┤     ├─────────────────────┤               │
│  │ · 对话消息窗口       │     │ · 向量存储           │               │
│  │ · 最近N轮对话        │     │ · 语义检索           │               │
│  │ · 摘要压缩          │     │ · 用户画像           │               │
│  │ · 当前任务上下文     │     │ · 事实知识库         │               │
│  └────────┬────────────┘     └────────┬────────────┘               │
│           │                           │                             │
│           ▼                           ▼                             │
│  ┌─────────────────────┐     ┌─────────────────────┐               │
│  │    工作记忆 WM       │     │   情景记忆 EM        │               │
│  │  Working Memory     │     │  Episodic Memory    │               │
│  ├─────────────────────┤     ├─────────────────────┤               │
│  │ · State中的变量      │     │ · 交互历史日志       │               │
│  │ · 中间计算结果       │     │ · 时间戳 + 上下文    │               │
│  │ · 当前推理步骤       │     │ · 用户偏好演变       │               │
│  │ · 工具调用结果       │     │ · 决策记录与反思      │               │
│  └─────────────────────┘     └─────────────────────┘               │
│                                                                     │
│  ┌───────────────────────────────────────────────────┐              │
│  │              检查点机制 Checkpointer                │              │
│  │  统一管理所有记忆类型，支持状态快照、回溯、恢复       │              │
│  └───────────────────────────────────────────────────┘              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

让我们逐一理解：

**短期记忆**——对应对话窗口中的最近几轮消息。就像你和人聊天时，能记住刚才说了什么，但聊了半小时后，开头的内容就模糊了。Agent 的短期记忆通常只保留最近 N 轮对话，超出部分要么丢弃，要么压缩成摘要。

**工作记忆**——对应 Agent 在推理过程中产生的中间状态。比如一个多步骤的 Agent，在执行第三步时需要用到第一步的计算结果，这个"持有"中间结果的能力就是工作记忆。在 LangGraph 中，工作记忆就是 State 中的各字段。

**长期记忆**——对应向量数据库中存储的知识和事实。用户说过"我喜欢吃辣"，Agent 把这条信息存入向量存储，下次用户问"推荐餐厅"时，Agent 能检索到这条偏好，给出辣菜推荐。长期记忆的容量几乎无限，且通过语义检索可以高效访问。

**情景记忆**——对应带时间戳的交互历史。不是简单地记住"用户喜欢辣"这个事实，而是记住"2024年12月1日，用户在讨论晚餐时提到喜欢吃辣"。情景记忆保留了上下文和时间线索，让 Agent 能更精准地理解用户需求的变化。

### 9.1.3 为什么 Agent 需要记忆

没有记忆的 Agent 存在三个致命问题：

1. **上下文断裂**：每次对话都是全新的，无法理解"它"指代什么，无法延续之前的话题
2. **重复劳动**：用户每次都要重新介绍自己的偏好，Agent 无法积累关于用户的知识
3. **无法学习**：Agent 无法从过去的成功或失败中学习，永远犯同样的错误

古人云："前事不忘，后事之师。"这正是记忆系统的核心价值——让 Agent 从过去的经历中学习，避免重复犯错，越用越懂你。

---

## 9.2 LangGraph 的检查点机制（Checkpointer）

在第6章中，我们使用 LangChain 的 ConversationMemory 来管理对话历史。那种方式有一个根本性的局限：它只是一个内存中的列表，进程重启就消失，也无法回溯到之前的某个状态。

LangGraph 引入了检查点机制（Checkpointer），这是一个质的飞跃。

### 9.2.1 检查点是什么

检查点（Checkpoint）就是图在执行过程中，每个节点完成后的状态快照。想象你在玩游戏时的存档——每通过一个关卡，系统自动帮你存档，你随时可以读取任意一个存档，回到那个时刻继续游戏。

LangGraph 的检查点机制实现了同样的效果：

- 每次 `invoke` 或 `stream` 调用后，自动保存当前状态
- 通过 `thread_id` 区分不同对话的状态空间
- 通过 `get_state_history()` 可以回溯任意历史状态
- 通过 `get_state()` 可以查看当前状态

### 9.2.2 检查点的工作流程

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  START   │────▶│  Node A  │────▶│  Node B  │────▶│   END    │
└──────────┘     └────┬─────┘     └────┬─────┘     └──────────┘
                      │                 │
                      ▼                 ▼
               ┌──────────┐      ┌──────────┐
               │Checkpoint│      │Checkpoint│
               │   #1     │      │   #2     │
               │ state_a  │      │ state_b  │
               └──────────┘      └──────────┘
                      │                 │
                      ▼                 ▼
               ┌──────────────────────────────────┐
               │         检查点存储后端              │
               │  (MemorySaver / Postgres / Redis) │
               └──────────────────────────────────┘

流程说明：
1. 执行 Node A 后，自动保存 Checkpoint #1（包含 A 的输出状态）
2. 执行 Node B 后，自动保存 Checkpoint #2（包含 B 的输出状态）
3. 所有检查点按 thread_id 隔离存储
4. 可以通过 get_state_history() 遍历所有检查点
5. 可以通过 update_state() 修改任意检查点的状态
```

### 9.2.3 代码实战：检查点基础

最简单的检查点后端是 `MemorySaver`，它将状态保存在内存中，适合开发和测试：

```python
# 兼容
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver


class State(TypedDict):
    messages: Annotated[list, add_messages]
    turn_count: int


def chat_node(state: State) -> dict:
    turn = state.get("turn_count", 0) + 1
    user_msg = state["messages"][-1].content if state["messages"] else ""
    return {
        "turn_count": turn,
        "messages": [{"role": "assistant", "content": f"[第{turn}轮] 你说了：{user_msg}"}],
    }


# 构建图
graph = StateGraph(State)
graph.add_node("chat", chat_node)
graph.add_edge(START, "chat")
graph.add_edge("chat", END)

# 关键
checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)

# 第一次调用
result1 = app.invoke(
    {"messages": [{"role": "user", "content": "你好，我叫小明"}], "turn_count": 0},
    config={"configurable": {"thread_id": "user-001"}},
)
# 输出

# 第二次调用（同一线程）—— 检查点自动恢复上一轮状态！
result2 = app.invoke(
    {"messages": [{"role": "user", "content": "我叫什么名字？"}]},
    config={"configurable": {"thread_id": "user-001"}},
)
# 输出
```

注意两个关键细节：

1. **`thread_id` 是检查点的隔离键**：不同的 `thread_id` 对应完全独立的状态空间。就像酒店的房间号，101房和102房的客人互不干扰。
2. **第二次调用时没有传 `turn_count`**：因为检查点自动恢复了上一轮的状态，`turn_count` 从 1 继续递增到 2。

### 9.2.4 时间旅行：回溯与恢复

检查点最强大的能力是"时间旅行"——你可以回到任意历史状态：

```python
# 查看状态历史
config = {"configurable": {"thread_id": "user-001"}}
history = list(app.get_state_history(config))

for state in history:
    print(f"checkpoint_id: {state.config['configurable']['checkpoint_id']}")
    print(f"  turn_count: {state.values.get('turn_count')}")
    print(f"  next: {state.next}")  # 下一步要执行的节点

# 回溯到某个检查点
target_checkpoint = history[-1]  # 选择最早的一个
# 可以基于这个检查点继续执行
```

这种能力在调试时极为有用——你可以精确地看到 Agent 在每一步的状态，理解它是如何做出某个决策的。

### 9.2.5 与第6章 ConversationMemory 的关键区别

| 维度 | 第6章 ConversationMemory | 第9章 LangGraph Checkpointer |
|------|------------------------|----------------------------|
| 存储方式 | 内存中的列表 | 检查点快照（可持久化） |
| 状态管理 | 手动 append 消息 | StateGraph 自动管理 |
| 对话隔离 | 需自己实现 | thread_id 天然隔离 |
| 状态回溯 | 不支持 | get_state_history() |
| 持久化 | 不支持 | Postgres/Redis 后端 |
| 多 Agent 协作 | 不支持 | 通过状态共享实现 |

可以看到，ConversationMemory 本质上只是一个"变量"，而 LangGraph 的检查点机制是一套完整的"状态管理系统"。这个进化，就像从手动管理内存进化到操作系统管理进程——你不再需要关心细节，系统帮你搞定一切。

---

## 9.3 短期记忆

短期记忆的核心挑战是**容量有限**。LLM 的上下文窗口（Context Window）虽然越来越大，从 4K 到 128K 再到 1M token，但仍然有上限。而且，塞入过多的无关消息不仅浪费 token，还会降低回复质量。

### 9.3.1 对话窗口管理

最直观的短期记忆策略是"滑动窗口"——只保留最近 N 轮对话，丢弃更早的消息：

```
时间 ──────────────────────────────────────▶

  消息1  消息2  消息3  消息4  消息5  消息6  消息7
   ↓      ↓      ↓
  丢弃   丢弃   丢弃    ↓      ↓      ↓      ↓
                       保留    保留    保留    保留
                       ─────────────────────────
                            当前窗口（N=4）
```

滑动窗口的优点是简单高效，缺点是直接丢弃旧消息，可能丢失重要信息。用户在第1轮说的"我叫小明"，到第7轮可能就完全消失了。

### 9.3.2 摘要压缩：更好的折中方案

摘要压缩是滑动窗口的进阶版——不是简单丢弃旧消息，而是先让 LLM 将其压缩成一段摘要，再丢弃原文。这样既控制了 token 数量，又保留了信息的精华：

```
原始消息：                        压缩后：
┌─────────────────┐
│ 用户：我叫小明    │
│ 助手：你好小明！  │          ┌─────────────────────────┐
│ 用户：我喜欢编程  │  ──────▶ │ 摘要：用户叫小明，喜欢     │
│ 助手：编程很有趣！│          │ 编程，对AI感兴趣          │
│ 用户：AI好有趣    │          └─────────────────────────┘
│ 助手：是的！      │
└─────────────────┘              保留近期对话：
                              ┌─────────────────┐
                              │ 用户：推荐书籍   │
                              │ 助手：推荐...    │
                              └─────────────────┘
```

### 9.3.3 代码实战：窗口管理 + 摘要压缩

在 LangGraph 中，我们可以把窗口管理和摘要压缩实现为图的一个节点，让它在每次对话后自动执行：

```python
# 兼容
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver


class State(TypedDict):
    messages: Annotated[list, add_messages]
    summary: str  # 历史摘要


MAX_WINDOW = 6       # 保留最近6条消息
SUMMARY_TRIGGER = 8  # 超过8条时触发压缩


def summarize_messages(messages: list, existing_summary: str) -> str:
    """将历史消息压缩为摘要"""
    # 实际项目中，这里应该调用 LLM 来生成摘要
    # 此处用简化逻辑演示
    prefix = f"之前的摘要：{existing_summary}\n" if existing_summary else ""
    parts = []
    for msg in messages:
        role = "用户" if msg.type == "human" else "助手"
        parts.append(f"{role}：{msg.content[:50]}")
    return prefix + "；".join(parts)


def window_manager_node(state: State) -> dict:
    """窗口管理节点：超阈值时触发摘要压缩"""
    messages = state.get("messages", [])
    summary = state.get("summary", "")

    if len(messages) > SUMMARY_TRIGGER:
        old_messages = messages[:-MAX_WINDOW]
        new_summary = summarize_messages(old_messages, summary)
        kept_messages = messages[-MAX_WINDOW:]
        return {"messages": kept_messages, "summary": new_summary}

    return {}


def chat_node(state: State) -> dict:
    """聊天节点"""
    summary = state.get("summary", "")
    messages = state.get("messages", [])

    context = f"[历史摘要] {summary}\n\n" if summary else ""
    user_msg = messages[-1].content if messages else ""
    reply = f"{context}收到：{user_msg}"

    return {"messages": [{"role": "assistant", "content": reply}]}


# 构建图
graph = StateGraph(State)
graph.add_node("window_manager", window_manager_node)
graph.add_node("chat", chat_node)
graph.add_edge(START, "window_manager")
graph.add_edge("window_manager", "chat")
graph.add_edge("chat", END)

checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)
```

这个设计的关键洞察是：**窗口管理是一个图节点，而不是外部逻辑**。这意味着它是声明式的、自动的——你不需要在每次调用后手动检查消息数量，图会在每轮对话后自动执行窗口管理节点。

### 9.3.3 摘要压缩的实践要点

在实际项目中实现摘要压缩，有几点需要注意：

1. **何时压缩**：不要等消息太多才压缩，否则 LLM 需要处理大量输入，既慢又贵。建议在消息数达到窗口大小的 1.5 倍时就触发。
2. **摘要质量**：摘要的质量直接影响后续对话的质量。建议使用比你主模型更强大的模型来生成摘要，或者至少使用同等能力的模型。
3. **增量摘要**：不要每次都从头摘要所有消息，而是基于现有摘要增量更新。这样效率更高，且不会因为单次摘要失误丢失信息。
4. **保留关键信息**：在摘要指令中明确要求 LLM 保留人名、偏好、决策等关键信息，忽略寒暄和重复内容。

---

## 9.4 长期记忆

短期记忆解决的是"当前对话中记住刚才说了什么"的问题，而长期记忆解决的是"跨对话记住用户是谁、知道什么"的问题。

### 9.4.1 为什么需要长期记忆

考虑这个场景：

- 周一，用户告诉 Agent："我养了一只叫小橘的猫。"
- 周三，用户问 Agent："推荐一些宠物用品。"

如果 Agent 只有短期记忆，周三的对话里根本不包含"小橘"的信息，Agent 就无法给出有针对性的推荐。但如果 Agent 把"用户养了一只叫小橘的猫"存入了长期记忆，周三检索到这条信息后，就可以推荐猫粮、猫砂等专属用品。

长期记忆让 Agent 真正"认识"用户，而不仅仅是"记得刚才说了什么"。

### 9.4.2 向量存储与语义检索

长期记忆的技术实现核心是**向量存储（Vector Store）+ 语义检索（Semantic Search）**。

基本流程如下：

```
  写入阶段：                           检索阶段：
  ──────────                          ──────────
  "用户喜欢吃辣"                       "推荐晚餐"
       │                                  │
       ▼                                  ▼
  Embedding模型                      Embedding模型
       │                                  │
       ▼                                  ▼
  [0.23, -0.15, 0.89, ...]          [0.18, -0.12, 0.75, ...]
       │                                  │
       ▼                                  ▼
  存入向量数据库                      计算与所有向量的相似度
                                          │
                                          ▼
                                    返回 Top-K 最相关结果
```

关键概念解释：

- **Embedding（嵌入）**：将文本转换为一个高维向量（通常是 768 或 1536 维），语义相近的文本对应的向量在空间中距离更近。
- **向量数据库**：专门存储和检索向量的数据库，如 Chroma、FAISS、Pinecone、PgVector 等。
- **语义检索**：根据查询的向量，找到数据库中与之最相似的向量，返回对应的原始文本。

### 9.4.3 代码实战：简易向量存储

为了让你零配置就能运行，我们实现一个基于哈希的简易向量存储。在正式项目中，你应该使用 Chroma、FAISS 或 PgVector：

```python
# 兼容
import math
from dataclasses import dataclass, field


@dataclass
class MemoryEntry:
    content: str
    metadata: dict = field(default_factory=dict)
    embedding: list = field(default_factory=list)


class SimpleVectorStore:
    """简易向量存储（演示用），实际项目用 Chroma / FAISS / PgVector"""

    def __init__(self):
        self.memories: list[MemoryEntry] = []

    @staticmethod
    def _simple_hash_embed(text: str, dim: int = 64) -> list[float]:
        """简易哈希嵌入（演示用），实际项目用 embedding 模型"""
        vec = [0.0] * dim
        for i, ch in enumerate(text):
            idx = (ord(ch) + i) % dim
            vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        """余弦相似度"""
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a)) or 1.0
        norm_b = math.sqrt(sum(x * x for x in b)) or 1.0
        return dot / (norm_a * norm_b)

    def add(self, content: str, metadata: dict = None):
        """添加记忆条目"""
        embedding = self._simple_hash_embed(content)
        self.memories.append(MemoryEntry(
            content=content, metadata=metadata or {}, embedding=embedding,
        ))

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        """语义检索"""
        query_emb = self._simple_hash_embed(query)
        scored = []
        for entry in self.memories:
            sim = self._cosine_similarity(query_emb, entry.embedding)
            scored.append({"content": entry.content, "metadata": entry.metadata, "score": sim})
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:top_k]
```

### 9.4.4 实际项目中的向量存储选型

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| Chroma | 原型开发、小规模 | 零配置、纯Python | 不适合大规模生产 |
| FAISS | 高性能检索、大规模 | 极快、Meta开源 | 需自己管理持久化 |
| PgVector | 生产环境、已有PG | 事务安全、与业务数据同库 | 需要PostgreSQL |
| Pinecone | 全托管、不想运维 | 零运维、自动扩缩 | 商业服务、数据在云端 |
| Milvus | 超大规模、企业级 | 分布式、高性能 | 运维复杂度高 |

选择建议：开发阶段用 Chroma，上线后切 PgVector（如果你已经在用 PostgreSQL），需要极致性能考虑 FAISS，不想运维就选 Pinecone。

### 9.4.5 长期记忆的写入策略

长期记忆不是什么都存，而是要有选择性地写入。常见的策略有：

1. **显式触发**：用户明确说"记住这个"或"这是我的偏好"时写入
2. **LLM 判断**：让 LLM 判断当前对话中是否包含值得长期记住的信息，如果有则提取并写入
3. **频率统计**：当某个信息在多轮对话中反复出现时，自动提升为长期记忆
4. **重要性评分**：为每条信息打分，只有超过阈值的才写入长期记忆

推荐组合使用策略2和3——让 LLM 提取关键事实，同时用频率统计确认信息的重要性。这样既不会遗漏，也不会存储大量无关紧要的信息。

---

## 9.5 LangGraph Memory

前几节我们已经在代码中使用了 MemorySaver，现在来深入了解 LangGraph 提供的完整记忆后端生态。

### 9.5.1 MemorySaver：内存后端

MemorySaver 是最简单的检查点后端，将状态保存在进程内存中：

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()
app = graph.compile(checkpointer=checkpointer)
```

它的特点是零配置、极快，但进程结束后数据全部丢失。适合以下场景：

- 开发和调试
- 单次运行的脚本
- 不需要跨进程共享状态的场景

**注意**：MemorySaver 不是线程安全的。如果在多线程环境中使用，需要为每个线程创建独立的 MemorySaver 实例，或者使用线程安全的后端。

### 9.5.2 PostgresSaver：生产级持久化

PostgresSaver 将检查点持久化到 PostgreSQL 数据库，是生产环境的首选：

```python
# 同步方式
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import connect

conn = connect("postgresql://user:pass@localhost:5432/mydb")
checkpointer = PostgresSaver(conn)
checkpointer.setup()  # 首次使用需建表

app = graph.compile(checkpointer=checkpointer)
```

PostgresSaver 的优势：

- **持久化**：进程重启后状态不丢失
- **事务安全**：利用 PostgreSQL 的事务保证状态一致性
- **并发安全**：多个进程可以安全地读写同一个检查点
- **与 PgVector 协同**：可以在同一个数据库中同时存储检查点和向量，简化架构

如果你使用异步框架，可以配合 `AsyncConnectionPool`：

```python
# 异步方式
from psycopg_pool import AsyncConnectionPool

pool = AsyncConnectionPool("postgresql://user:pass@localhost:5432/mydb")
# 异步版本需要使用 AsyncPostgresSaver
```

### 9.5.3 Redis 后端：高频读写场景

对于需要亚毫秒级读写的场景，Redis 是更好的选择：

```python
# 需要安装
from langgraph.checkpoint.redis import RedisSaver

checkpointer = RedisSaver.from_conn_string("redis://localhost:6379")
checkpointer.setup()  # 首次使用需初始化
app = graph.compile(checkpointer=checkpointer)
```

Redis 后端的优势：

- **极低延迟**：亚毫秒级的读写性能
- **天然支持 TTL**：可以为检查点设置过期时间，自动清理旧数据
- **高并发**：Redis 天然支持高并发读写

### 9.5.4 后端对比与选型

| 维度 | MemorySaver | PostgresSaver | Redis |
|------|------------|---------------|-------|
| 持久化 | 否 | 是 | 是 |
| 并发安全 | 否 | 是 | 是 |
| 延迟 | 极低（<1ms） | 低（~5ms） | 极低（<1ms） |
| 事务支持 | 否 | 是 | 有限 |
| 数据容量 | 受内存限制 | 磁盘级 | 受内存限制 |
| 运维成本 | 零 | 中 | 中 |
| 适用场景 | 开发测试 | 生产环境 | 高频读写 |

选型建议：

- **开发阶段**：MemorySaver，零配置快速迭代
- **上线初期**：PostgresSaver，如果已经有 PostgreSQL 实例的话直接复用
- **高并发场景**：Redis，特别是用户量大、对话频繁的应用
- **混合方案**：Redis 做热数据缓存 + PostgreSQL 做冷数据持久化

---

## 9.6 实战

理论讲完了，现在让我们把所有知识串联起来，构建一个真正有长期记忆的个人助手。这个助手能够：

1. 记住用户的个人信息和偏好（长期记忆）
2. 在对话中保持上下文连贯（短期记忆）
3. 自动从对话中提取关键事实存入记忆
4. 根据用户的问题检索相关知识

### 9.6.1 架构设计

```
用户输入
   │
   ▼
┌──────────────────┐     ┌──────────────────┐
│  memory_extractor │────▶│     recall       │
│  从对话中提取事实  │     │  检索相关长期记忆  │
└──────────────────┘     └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │     respond      │
                         │  生成回复         │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  window_compress │
                         │  窗口压缩         │
                         └────────┬─────────┘
                                  │
                                  ▼
                              输出回复
```

四个节点的职责清晰分明：

- `memory_extractor`：从对话中提取事实，写入长期记忆
- `recall`：检索与当前问题相关的长期记忆
- `respond`：结合长期记忆和当前对话生成回复
- `window_compress`：对短期记忆进行窗口管理和摘要压缩

### 9.6.2 完整代码

完整代码在 `memory_system.py` 文件中，这里我们重点讲解核心设计决策。

**状态定义**——个人助手需要哪些"记忆字段"：

```python
class PersonalAssistantState(TypedDict):
    messages: Annotated[list, add_messages]  # 对话消息（短期记忆）
    summary: str                             # 历史摘要（短期记忆压缩）
    user_profile: dict                       # 用户画像（长期记忆-结构化）
    memory_store: dict                       # 事实记忆库（长期记忆-键值）
    turn_count: int                          # 对话轮次（工作记忆）
```

**记忆提取节点**——让 Agent 学会"记住"：

```python
def memory_extractor_node(self, state):
    """从对话中提取事实，写入长期记忆"""
    messages = state.get("messages", [])
    profile = dict(state.get("user_profile", {}))
    memory = dict(state.get("memory_store", {}))

    if messages and messages[-1].type == "human":
        self._remember_facts(messages[-1].content, profile, memory)

    return {"user_profile": profile, "memory_store": memory}
```

**记忆检索节点**——让 Agent 学会"回想"：

```python
def recall_node(self, state):
    """检索与当前问题相关的长期记忆"""
    messages = state.get("messages", [])
    query = messages[-1].content
    context = self._recall_memories(query)
    return {}
```

**响应生成节点**——综合短期和长期记忆生成回复：

```python
def response_node(self, state):
    """结合短期摘要和长期记忆生成回复"""
    messages = state.get("messages", [])
    profile = state.get("user_profile", {})
    summary = state.get("summary", "")

    user_msg = messages[-1].content
    context = self._recall_memories(user_msg)

    # 摘要作为短期记忆上下文
    if summary:
        context = f"[近期对话摘要] {summary}\n[长期记忆] {context}"

    reply = self._generate_response(user_msg, context, profile)
    return {"messages": [{"role": "assistant", "content": reply}]}
```

### 9.6.3 运行效果

```
[第1轮] 用户: 你好，我叫小华
[第1轮] 助手: 你好！有什么可以帮你的？
用户画像: {'name': '用户的名字是小华'}

[第2轮] 用户: 我喜欢Go语言和分布式系统
[第2轮] 助手: 收到你的消息：我喜欢Go语言和分布式系统
用户画像: {'name': '用户的名字是小华', 'preference': '用户喜欢Go语言和分布式系统'}

[第5轮] 用户: 推荐一些技术书籍给我
[第5轮] 助手: 根据你的兴趣（用户喜欢Go语言和分布式系统），
       我推荐你看看以下内容：
       Go语言的goroutine非常轻量...

[第6轮] 用户: 你还记得我的名字吗？
[第6轮] 助手: 我记得你告诉过我，你的名字是小华。
       温故而知新，我不会忘的！
```

从运行效果可以看到，Agent 成功实现了"温故而知新"——它从对话中提取了用户的姓名和偏好（长期记忆），在后续对话中主动使用这些信息给出个性化回复。

### 9.6.4 关键设计决策

在构建这个助手时，有几个重要的设计决策值得讨论：

**决策1：记忆提取放在哪个位置？**

我们将记忆提取放在图的最前面，在响应生成之前执行。这样做的好处是：同一轮对话中，Agent 就能利用刚刚提取的事实。比如用户说"我叫小华"，记忆提取节点会立刻将这条信息写入 user_profile，后续的响应节点就能使用。

**决策2：短期记忆和长期记忆如何协同？**

短期记忆（消息窗口 + 摘要）和长期记忆（向量存储）不是互斥的，而是互补的。短期记忆保留最近对话的细节，长期记忆提供跨对话的全局知识。在响应生成时，两者共同作为上下文输入 LLM。

**决策3：向量存储的嵌入模型选择？**

在本章的演示代码中，我们使用简单的哈希嵌入来避免外部依赖。但在实际项目中，你应该使用真正的 Embedding 模型，如 OpenAI 的 `text-embedding-3-small` 或开源的 `bge-large-zh`。嵌入质量直接决定语义检索的效果，是长期记忆系统的基石。

### 9.6.5 进阶优化方向

这个个人助手还有很大的优化空间：

1. **记忆遗忘**：不是所有记忆都需要永久保存。可以引入遗忘机制，比如基于时间衰减或访问频率来淘汰不重要的记忆
2. **记忆冲突解决**：用户可能在不同的时间说了矛盾的信息（"我喜欢吃辣"→"最近胃不好，不吃辣了"），需要设计冲突解决策略
3. **记忆反思**：定期让 Agent 回顾自己的记忆，发现矛盾、补充关联、提升记忆质量
4. **分层存储**：热数据放 Redis、温数据放 PostgreSQL、冷数据归档到对象存储
5. **隐私保护**：长期记忆中可能包含敏感信息，需要设计数据脱敏和访问控制机制

---

## 进阶拓展

### 记忆系统与 RAG 的关系

你可能已经注意到，长期记忆的技术实现（向量存储 + 语义检索）和 RAG（Retrieval-Augmented Generation，检索增强生成）几乎一模一样。这不是巧合——RAG 本质上就是给 LLM 加上了一个"外置的长期记忆"。

两者的区别在于：

- **RAG**：检索的是外部知识库中的文档，是"通用的、公共的"知识
- **长期记忆**：检索的是 Agent 自身在交互中积累的事实，是"个性化的、私有的"知识

在实际项目中，这两者常常结合使用：RAG 提供领域知识，长期记忆提供用户偏好和上下文。两者共同作为 LLM 的上下文输入，让 Agent 既有专业知识，又懂用户心意。

### 多 Agent 记忆共享

在多 Agent 系统中，记忆共享是一个有趣的话题。比如一个客服系统有多个 Agent（售前、售后、技术支持），它们如何共享关于同一个用户的信息？

LangGraph 的设计天然支持这种场景——多个 Agent 可以共享同一个检查点后端（如 PostgresSaver），通过相同的 `thread_id` 访问共享状态。更精细的共享可以通过在 State 中定义共享字段来实现。

### 记忆安全与隐私

长期记忆中存储了大量用户个人信息，隐私保护是必须考虑的：

1. **数据最小化**：只存储必要的信息，不要什么都记
2. **加密存储**：敏感信息应该加密后再存入数据库
3. **用户控制**：让用户可以查看、修改、删除自己的记忆
4. **合规性**：遵守 GDPR、个人信息保护法等法规要求

---

## 习题

1. **记忆持久化**：将本章的个人助手从 MemorySaver 迁移到 PostgresSaver。要求：使用 Docker 启动一个 PostgreSQL 实例，配置 PostgresSaver，验证重启后记忆不丢失。

2. **LLM 驱动的记忆提取**：将 `_remember_facts` 方法中的关键词匹配替换为 LLM 调用。要求：使用 LangChain 的 ChatModel，设计合适的 prompt 让 LLM 从对话中提取结构化事实（JSON 格式），并写入向量存储。

3. **记忆遗忘机制**：为个人助手实现基于时间衰减的遗忘机制。要求：每条记忆有一个时间戳和访问次数，每次检索后更新访问次数，定期清理访问次数低于阈值且时间过久的记忆。设计衰减公式并解释你的设计选择。

## 参考文献

1. LangGraph Checkpoint Documentation. https://langchain-ai.github.io/langgraph/
2. Zhong, W. et al. "MemoryBank: Enhancing Large Language Models with Long-Term Memory." AAAI 2024.

## 开放讨论

1. **记忆的边界**：如果 Agent 记住了用户在一年前说的"我讨厌某个品牌"，但用户后来改变想法了，Agent 应该如何处理这种"过时的记忆"？是否应该设计记忆的"保质期"？

2. **记忆的诚实**：如果用户要求 Agent "忘记我说过的某件事"，Agent 是否应该真的删除这条记忆？从技术上看，删除一条向量可能影响检索质量；从伦理上看，用户有"被遗忘权"。你会如何平衡？

3. **记忆的归属**：在多 Agent 系统中，Agent A 了解到的用户信息，是否应该自动共享给 Agent B？如果用户只信任 Agent A 呢？如何设计记忆的访问控制？

---
