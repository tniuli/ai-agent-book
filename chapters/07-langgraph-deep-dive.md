# 第7章 LangGraph 深度实战

> 变则通，通则久。——《易经·系辞下》

在第6章，我们用 LangChain 的 Chain 把 LLM 调用串了起来——Prompt 模板填入变量，传给 LLM，输出再交给下一个环节处理。这就像流水线：原料进去，成品出来，方向单一，路径固定。但真实的 Agent 任务很少这么简单——用户可能中途改主意，可能需要根据结果选择不同分支，可能需要回退重试。线性 Chain 处理不了这些"变"，而 LangGraph 用有向图来建模 Agent 的执行流程，让"变"成为可能。本章将带你理解从线性 Chain 到有向图的演进逻辑，掌握 LangGraph 的核心概念 State / Node / Edge，亲手构建带意图路由的客服 Agent 和多步研究 Agent，并了解 LangGraph.js 的 TypeScript 实现。

---

## 7.1 从 Chain 到 Graph 的演进——为什么需要图？

在第 6 章，我们用 LangChain 的 Chain 把 LLM 调用串了起来——Prompt 模板填入变量，传给 LLM，输出再交给下一个环节处理。这就像流水线：原料进去，成品出来，方向单一，路径固定。

但真实的 Agent 场景，很少是一条直线能搞定的。

想象一个客服系统：用户说"我要退款"，你需要走退款流程；用户说"这个产品怎么用"，你需要走知识库查询流程；用户说"我要找人工"，你得把对话转接出去。三条路，三种走向，取决于用户的意图。用线性 Chain 怎么做？写一堆 if-else？随着分支增多，代码会变成一碗面条——你很难理清逻辑从哪里来、到哪里去。

再想象一个研究型 Agent：它需要先搜索资料，判断信息是否充分，不够就换关键词再搜，够了就整理总结，遇到矛盾还要交叉验证。这是一个**循环**——搜索、判断、再搜索，直到满意为止。线性 Chain 根本无法表达"回到上一步重来"的逻辑。

这就是我们需要图（Graph）的原因：

| 场景 | Chain 能力 | Graph 能力 |
|------|-----------|-----------|
| 单线路处理 | 足够 | 足够 |
| 条件分支 | if-else 嵌套，难维护 | Conditional Edge，清晰声明 |
| 循环逻辑 | 无法表达 | Edge 指回前序节点即可 |
| 状态共享 | 靠手动传递参数 | State 自动流转 |
| 流程可视化 | 代码即逻辑，不可视 | 图结构本身就是文档 |

**万物皆有序**——《易经》讲"天尊地卑，乾坤定矣"，天地万物各有其位、各循其序。Agent 的行为也需要秩序：先做什么、后做什么、什么条件走哪条路，这些不是随意的，而是结构化的。图结构让 Agent 的行为有序可控，每一步的去向都有据可依，而不是一团乱麻。

LangGraph 正是为此而生。它把 Agent 的执行流程建模为**有向图（Directed Graph）**——节点是计算单元，边是流转方向，状态在节点之间自动传递。你只需要声明"图长什么样"，LangGraph 负责让它跑起来。

```
从 Chain 到 Graph 的演进：

  Chain（线性）：
  A ──→ B ──→ C ──→ 输出

  Graph（有向图）：
       ┌──────────────┐
       │              ▼
  A ──→ B ──→ C ──→ D ──→ 输出
       │         ▲
       └─────────┘  (条件跳转 / 循环)
```

---

## 7.2 核心概念

LangGraph 的世界观很简单，只有四个核心概念。搞懂它们，你就搞懂了 LangGraph。

### 7.2.1 State——状态

State 是图流转过程中的"共享数据"。你可以把它理解为一辆推车，每个节点都可以往推车里放东西、从推车里取东西，推车自动跟着流程走。

在代码中，State 通常是一个 TypedDict 或 Pydantic Model：

```python
from typing import TypedDict, Annotated
from langgraph.graph import add_messages

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]  # 对话历史
    intent: str | None                        # 用户意图
    search_results: list                      # 搜索结果
    final_answer: str | None                  # 最终回答
```

这里有个关键细节：`Annotated[list, add_messages]`。`add_messages` 是 LangGraph 提供的 reducer 函数——当多个节点往 `messages` 里写内容时，它不会覆盖，而是追加。这种"只合并不覆盖"的机制，是 State 管理的核心设计。

### 7.2.2 Node——节点

Node 是图中的计算单元，本质上就是一个函数。它接收当前的 State，做一些处理（调用 LLM、执行工具、做判断等），然后返回 State 的更新部分。

```python
def classify_intent(state: AgentState) -> dict:
    """分类用户意图"""
    user_message = state["messages"][-1].content
    # 调用 LLM 判断意图...
    return {"intent": "refund"}  # 只返回需要更新的字段
```

注意：节点函数**不需要返回完整的 State**，只需返回你想更新的字段。LangGraph 会自动合并到当前 State 中。这就像 Git 的 partial commit——你只提交改动的部分。

### 7.2.3 Edge——边

Edge 连接两个节点，定义执行顺序。它是最简单的流转方式：A 执行完，自动执行 B。

```python
graph.add_edge("classify_intent", "handle_refund")
```

### 7.2.4 Conditional Edge——条件边

Conditional Edge 是 LangGraph 的精髓所在。它根据当前 State 的值，决定下一步走哪条路。这就是我们之前说的"意图路由"——根据用户意图，分发到不同的处理分支。

```python
graph.add_conditional_edges(
    "classify_intent",    # 从哪个节点出发
    route_by_intent,      # 路由函数：接收 State，返回下一个节点名
    {
        "refund": "handle_refund",
        "inquiry": "handle_inquiry",
        "human": "transfer_human",
    }
)
```

路由函数 `route_by_intent` 只需要读取 State 中的 `intent` 字段，返回一个字符串（如 `"refund"`），LangGraph 就会根据映射表找到对应的下一个节点。

**因势利导**——《孟子》讲"顺天者存，逆天者亡"，又说"虽有智慧，不如乘势"。Conditional Edge 正是"因势利导"的技术实现——它不预设一条固定路径，而是根据当前的"势"（State 的值）引导 Agent 走向最合适的方向。用户要退款就走退款路，要咨询就走咨询路，势变则路变。

四个概念的关系可以用下图表示：

```
┌─────────────────────────────────────────────────────┐
│                   LangGraph 图结构                    │
│                                                     │
│   ┌─────────┐        ┌─────────┐                   │
│   │  Node A │──────→ │  Node B │                   │
│   │ (分类)  │  Edge  │ (退款)  │                   │
│   └────┬────┘        └─────────┘                   │
│        │                                           │
│        │ Conditional Edge                           │
│        ├── intent="inquiry" ──→ ┌─────────┐        │
│        │                        │  Node C │        │
│        │                        │ (咨询)  │        │
│        │                        └─────────┘        │
│        │                                           │
│        └── intent="human" ───→ ┌─────────┐        │
│                                 │  Node D │        │
│                                 │ (转人工) │        │
│                                 └─────────┘        │
│                                                     │
│   State { messages, intent, results, ... }          │
│          ↑ 在所有节点之间自动流转                     │
└─────────────────────────────────────────────────────┘
```

---

## 7.3 State 定义与状态流转

State 是 LangGraph 的血液。理解 State 的定义方式和流转机制，是写好 LangGraph 应用的关键。

### 7.3.1 定义 State 的两种方式

**方式一：TypedDict（推荐入门使用）**

```python
from typing import TypedDict, Annotated
from langgraph.graph import add_messages

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    current_step: str
    search_results: list
    iteration_count: int
```

TypedDict 轻量直观，适合快速原型。`Annotated[type, reducer]` 指定了字段的合并策略。

**方式二：Pydantic BaseModel（推荐生产使用）**

```python
from pydantic import BaseModel
from langgraph.graph import add_messages

class AgentState(BaseModel):
    messages: Annotated[list, add_messages] = []
    current_step: str = "init"
    search_results: list = []
    iteration_count: int = 0
```

Pydantic 的优势在于**数据验证**——如果某个节点意外写入了类型错误的数据，Pydantic 会立即报错，而不是在下游节点才暴露问题。

### 7.3.2 Reducer 机制：状态的合并策略

当多个节点对同一个 State 字段进行写入时，LangGraph 需要决定如何合并这些更新。这就是 Reducer 的作用。

LangGraph 内置了两种合并策略：

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| 默认（无 Reducer） | 后写入覆盖前值 | 简单状态，如 `intent`、`current_step` |
| `add_messages` | 追加而非覆盖 | 对话历史 `messages` |

```python
# 无 Reducer：最后写入的值生效
class State(TypedDict):
    intent: str           # 后写的覆盖先写的

# 有 Reducer：追加合并
class State(TypedDict):
    messages: Annotated[list, add_messages]  # 追加而非覆盖
```

`add_messages` 还有一个巧妙的设计：如果写入的 message 的 `id` 和已有 message 的 `id` 相同，它会**替换**而非追加。这让你可以"修改"之前某条消息，而不是只能追加新消息。

### 7.3.3 状态流转的生命周期

一个完整的 State 流转周期如下：

```
初始化 State
     │
     ▼
Node A 读取 State ──→ 处理 ──→ 返回 State 更新
     │                                    │
     │          LangGraph 自动合并更新      │
     │◄───────────────────────────────────┘
     │
     ▼
Node B 读取合并后的 State ──→ 处理 ──→ 返回更新
     │                                          │
     │          LangGraph 自动合并更新            │
     │◄─────────────────────────────────────────┘
     │
     ▼
   ... 继续流转 ...
```

关键点：**每个节点看到的永远是合并后的最新 State**。你不需要操心"上一步改了什么"，LangGraph 保证一致性。

---

## 7.4 图的构建与编译

有了 State、Node 和 Edge，我们还需要一个"施工队"把图搭起来，再一个"指挥官"让它跑起来。这就是 `StateGraph` 和 `compile()`。

### 7.4.1 构建图的四步法

```python
from langgraph.graph import StateGraph, START, END

# 第一步
graph = StateGraph(AgentState)

# 第二步：添加节点
graph.add_node("classify", classify_intent)
graph.add_node("handle_refund", handle_refund)
graph.add_node("handle_inquiry", handle_inquiry)

# 第三步：添加边——定义流转
graph.add_edge(START, "classify")                           # 入口
graph.add_conditional_edges("classify", route, {...})       # 条件分支
graph.add_edge("handle_refund", END)                        # 出口
graph.add_edge("handle_inquiry", END)                       # 出口

# 第四步：编译
app = graph.compile()
```

`START` 和 `END` 是 LangGraph 的两个特殊节点，分别代表图的入口和出口。每个图必须至少有一条从 `START` 出发的边，和至少一条到达 `END` 的边。

### 7.4.2 compile() 做了什么？

`compile()` 不是"编译成机器码"，而是做了三件事：

1. **验证图结构**：检查是否有孤立节点、是否有从 START 到 END 的可达路径、是否有循环没有退出条件等
2. **构建执行计划**：确定每个节点执行完后该做什么
3. **返回 Runnable**：编译后的图是一个 LangChain Runnable，支持 `invoke()`、`stream()`、`astream()` 等调用方式

```python
# 编译后的图可以这样调用
result = app.invoke({"messages": [HumanMessage(content="我要退款")]})

# 也支持流式调用
async for event in app.astream_events({"messages": [...]}, version="v2"):
    print(event)
```

如果图结构有问题，`compile()` 会直接报错。这比运行时才发现"某个节点没有出路"要友好得多——编译期报错永远好过运行时炸掉。

### 7.4.3 查看图结构

编译后的图可以用 `get_graph()` 方法获取结构信息，甚至可以可视化：

```python
# 打印图的 ASCII 结构
print(app.get_graph().draw_ascii())

# 保存为 Mermaid 图
print(app.get_graph().draw_mermaid())
```

这个功能在调试时特别好用——你写的图和你想的图，可能不是同一个图。

### 7.4.4 完整最小示例

让我们用一个最简单的图来串起所有概念：

```
START ──→ greet ──→ respond ──→ END
```

```python
# 兼容

from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END, add_messages
from langchain_core.messages import HumanMessage, AIMessage

class SimpleState(TypedDict):
    messages: Annotated[list, add_messages]

def greet(state: SimpleState) -> dict:
    return {"messages": [AIMessage(content="你好！有什么可以帮你的？")]}

def respond(state: SimpleState) -> dict:
    last_human = [m for m in state["messages"] if isinstance(m, HumanMessage)][-1]
    return {"messages": [AIMessage(content=f"收到你的消息：{last_human.content}")]}

graph = StateGraph(SimpleState)
graph.add_node("greet", greet)
graph.add_node("respond", respond)
graph.add_edge(START, "greet")
graph.add_edge("greet", "respond")
graph.add_edge("respond", END)

app = graph.compile()
result = app.invoke({"messages": [HumanMessage(content="你好")]})
print(result["messages"][-1].content)
# 输出：收到你的消息：你好
```

---

## 7.5 实战

理论讲完了，让我们动手构建一个真正的客服 Agent。在动手之前有两点值得留意：条件边的路由函数必须覆盖所有可能的返回值——如果某个返回值在 `add_conditional_edges` 的映射表中找不到对应节点，运行时会直接抛出 KeyError；同样，State 定义时需要预留所有可能用到的字段，用 `Optional` 标注可能为空的字段，否则节点读取缺失字段时也会 KeyError。这两个问题一旦踩中排查起来相当耗时，所以在写路由函数和 State 定义时就应提前规避。这个 Agent 能根据用户意图，自动路由到不同的处理分支，还能在必要时转接人工。

### 7.5.1 需求分析

我们的客服 Agent 需要处理三种意图：

| 意图 | 处理逻辑 |
|------|---------|
| 退款 | 查询订单、验证退款条件、执行退款 |
| 咨询 | 从知识库检索答案、生成回复 |
| 其他/转人工 | 收集信息后转接人工客服 |

图结构如下：

```
                    ┌──────────────┐
                    │   START      │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ classify     │
                    │ (意图分类)   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        intent=refund  intent=inquiry  intent=other
              │            │            │
              ▼            ▼            ▼
      ┌────────────┐ ┌──────────┐ ┌──────────┐
      │handle_refund│ │knowledge │ │transfer  │
      │ (退款处理) │ │ (知识查询)│ │(转人工)  │
      └──────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             ▼             ▼            ▼
      ┌────────────┐ ┌──────────┐ ┌──────────┐
      │ generate   │ │ generate │ │ generate │
      │ _response  │ │ _response│ │ _response│
      └──────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             ▼             ▼            ▼
          ┌──────────────────────────────┐
          │           END                │
          └──────────────────────────────┘
```

### 7.5.2 完整代码实现

代码文件：`customer_service_agent.py`

```python
# 兼容
# 运行

import os
from typing import TypedDict, Annotated, Literal
from langgraph.graph import StateGraph, START, END, add_messages
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI

# ── State 定义 ──────────────────────────────────────

class CustomerServiceState(TypedDict):
    messages: Annotated[list, add_messages]
    intent: str | None
    order_info: dict | None
    knowledge_result: str | None
    response: str | None

# ── LLM 初始化 ──────────────────────────────────────

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# ── 模拟数据 ────────────────────────────────────────

MOCK_ORDERS = {
    "ORD001": {"product": "蓝牙耳机", "price": 299, "status": "delivered", "days_since_delivery": 5},
    "ORD002": {"product": "充电宝", "price": 99, "status": "delivered", "days_since_delivery": 15},
    "ORD003": {"product": "手机壳", "price": 39, "status": "shipped", "days_since_delivery": 0},
}

KNOWLEDGE_BASE = {
    "退货政策": "商品签收后7天内可申请退货退款，需保持商品完好无损。",
    "物流查询": "请在订单详情页查看物流信息，或拨打物流客服热线 400-xxx-xxxx。",
    "保修政策": "电子产品享受1年保修服务，请在保修期内联系售后。",
}

# ── 节点函数 ────────────────────────────────────────

def classify_intent(state: CustomerServiceState) -> dict:
    """分类用户意图"""
    system_prompt = """你是一个意图分类器。根据用户消息判断意图类别。

    只能返回以下三个类别之一：
    - refund：用户想要退款、退货、退钱
    - inquiry：用户在咨询产品使用、政策、物流等问题
    - other：其他情况，需要转接人工

    只返回类别名称，不要返回其他内容。"""

    messages = [
        SystemMessage(content=system_prompt),
        state["messages"][-1],  # 最后一条用户消息
    ]
    response = llm.invoke(messages)
    intent = response.content.strip().lower()

    # 确保返回合法意图
    if intent not in ("refund", "inquiry", "other"):
        intent = "other"

    return {"intent": intent}


def handle_refund(state: CustomerServiceState) -> dict:
    """处理退款流程"""
    user_msg = state["messages"][-1].content

    # 模拟
    order_id = None
    for oid in MOCK_ORDERS:
        if oid in user_msg:
            order_id = oid
            break

    if not order_id:
        return {
            "order_info": None,
            "response": "请提供您的订单号，以便我为您查询退款信息。",
        }

    order = MOCK_ORDERS[order_id]
    # 退款条件：已签收且在7天内
    if order["status"] == "delivered" and order["days_since_delivery"] <= 7:
        result = f"订单 {order_id}（{order['product']}，¥{order['price']}）符合退款条件，退款将在3个工作日内原路返回。"
    elif order["status"] != "delivered":
        result = f"订单 {order_id} 尚未签收，无法申请退款。请确认收货后再试。"
    else:
        result = f"订单 {order_id} 已超过7天退货期（签收已{order['days_since_delivery']}天），无法退款。"

    return {"order_info": order, "response": result}


def handle_inquiry(state: CustomerServiceState) -> dict:
    """处理咨询问题"""
    user_msg = state["messages"][-1].content

    # 简单关键词匹配检索知识库
    relevant = []
    for key, value in KNOWLEDGE_BASE.items():
        if any(kw in user_msg for kw in key) or any(kw in user_msg for kw in value[:10]):
            relevant.append(f"【{key}】{value}")

    if relevant:
        knowledge = "\n".join(relevant)
    else:
        knowledge = "未找到相关信息，建议转接人工客服获取帮助。"

    # 用 LLM 基于知识库生成回答
    system_prompt = f"""你是客服助手，请根据以下知识库信息回答用户问题。
如果知识库中没有相关信息，请如实告知并建议转人工。

知识库：
{knowledge}"""

    response = llm.invoke([
        SystemMessage(content=system_prompt),
        state["messages"][-1],
    ])

    return {"knowledge_result": knowledge, "response": response.content}


def transfer_human(state: CustomerServiceState) -> dict:
    """转接人工客服"""
    user_msg = state["messages"][-1].content
    return {
        "response": f"已收到您的请求（\"{user_msg[:50]}...\"），正在为您转接人工客服，请稍候。"
    }


def generate_response(state: CustomerServiceState) -> dict:
    """生成最终回复"""
    response_text = state.get("response", "抱歉，我暂时无法处理您的请求。")
    return {"messages": [AIMessage(content=response_text)]}

# ── 路由函数 ────────────────────────────────────────

def route_by_intent(state: CustomerServiceState) -> str:
    """根据意图路由到不同处理节点"""
    return state.get("intent", "other")

# ── 构建图 ──────────────────────────────────────────

graph = StateGraph(CustomerServiceState)

# 添加节点
graph.add_node("classify", classify_intent)
graph.add_node("handle_refund", handle_refund)
graph.add_node("handle_inquiry", handle_inquiry)
graph.add_node("transfer_human", transfer_human)
graph.add_node("generate_response", generate_response)

# 添加边
graph.add_edge(START, "classify")
graph.add_conditional_edges(
    "classify",
    route_by_intent,
    {
        "refund": "handle_refund",
        "inquiry": "handle_inquiry",
        "other": "transfer_human",
    },
)
graph.add_edge("handle_refund", "generate_response")
graph.add_edge("handle_inquiry", "generate_response")
graph.add_edge("transfer_human", "generate_response")
graph.add_edge("generate_response", END)

# 编译
app = graph.compile()

# ── 测试 ────────────────────────────────────────────

if __name__ == "__main__":
    # 测试1：退款请求
    print("=== 测试1：退款请求 ===")
    result = app.invoke({
        "messages": [HumanMessage(content="我要退 ORD001 的蓝牙耳机")]
    })
    print(f"回复: {result['messages'][-1].content}\n")

    # 测试2：咨询问题
    print("=== 测试2：咨询问题 ===")
    result = app.invoke({
        "messages": [HumanMessage(content="你们的退货政策是什么？")]
    })
    print(f"回复: {result['messages'][-1].content}\n")

    # 测试3：转人工
    print("=== 测试3：转人工 ===")
    result = app.invoke({
        "messages": [HumanMessage(content="我要投诉你们的配送服务")]
    })
    print(f"回复: {result['messages'][-1].content}\n")

    # 打印图结构
    print("=== 图结构 ===")
    print(app.get_graph().draw_ascii())
```

### 7.5.3 关键设计解析

**意图分类节点的 Prompt 设计**

注意 `classify_intent` 函数中的系统提示词——它被设计成一个"分类器"：输入用户消息，输出类别标签。这是一个关键的 Prompt Engineering 技巧：**把复杂的路由判断封装在提示词中，而不是用 Python if-else**。这样做的好处是，新增意图类型时只需修改提示词和映射表，不用改代码逻辑。

```
📌 Prompt Engineering 融入：LangGraph 中的意图路由提示词

在 Conditional Edge 的场景中，路由函数的准确性决定了整个图的行为。
有两种实现路由的方式：

1. 代码路由（硬编码）：在 Python 函数中用 if-else 判断
   - 优点：确定性高、速度快
   - 缺点：新增分支要改代码

2. LLM 路由（提示词）：让 LLM 输出类别标签
   - 优点：灵活，新增分支只改提示词
   - 缺点：有误判风险，需要约束输出格式

最佳实践：用 LLM 做分类，但用枚举约束输出范围。
本例中提示词明确限定 "只能返回以下三个类别之一"，
避免 LLM 输出意料之外的标签导致路由失败。
```

**汇合节点（generate_response）的设计**

三个处理分支最终都汇聚到 `generate_response` 节点。这种"分-合"结构在 LangGraph 中很常见。汇合节点的好处是：无论走了哪条分支，最终输出的格式和处理逻辑都统一，不会出现"退款分支返回的是纯文本，咨询分支返回的是 JSON"这种不一致问题。

---

## 7.6 实战

客服 Agent 展示了条件分支，接下来我们构建一个更复杂的研究型 Agent——它会**循环**搜索，直到收集到足够信息才停下来。这就涉及 LangGraph 的另一大能力：循环图。

### 7.6.1 需求分析

Research Agent 的工作流程：

1. 接收研究问题
2. 生成搜索关键词
3. 执行搜索（模拟）
4. 判断信息是否充分——不够就生成新关键词再搜，够了就总结
5. 生成研究报告

```
                    ┌──────────┐
                    │  START   │
                    └────┬─────┘
                         │
                         ▼
                  ┌──────────────┐
                  │  formulate   │
                  │  (生成查询)  │
                  └──────┬───────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   search     │◄──────────┐
                  │  (执行搜索)  │           │
                  └──────┬───────┘           │
                         │                   │
                         ▼                   │
                  ┌──────────────┐           │
                  │  evaluate    │           │
                  │ (评估充分性) │           │
                  └──────┬───────┘           │
                         │                   │
              ┌──────────┴──────────┐        │
              │                     │        │
        sufficient=False      sufficient=True │
              │                     │        │
              ▼                     ▼        │
      ┌──────────────┐     ┌──────────────┐  │
      │  reformulate │     │  summarize   │  │
      │ (重新组织查询)│     │  (总结报告)  │  │
      └──────┬───────┘     └──────┬───────┘  │
             │                    │          │
             └────────────────────┘          │
                    回到 search               │
                                             │
                                    ┌─────┐  │
                                    │ END │◄─┘
                                    └─────┘
```

### 7.6.2 循环与退出条件

在 LangGraph 中构建循环非常自然——只需要添加一条从后序节点指回前序节点的边。但关键问题是：**什么时候退出循环？**

常见的退出策略有三种：

| 策略 | 实现方式 | 适用场景 |
|------|---------|---------|
| 状态判断 | Conditional Edge 检查 State 中的标志位 | LLM 判断"信息足够了" |
| 计数器 | 检查 State 中的迭代次数 | 防止无限循环 |
| 混合 | 同时检查标志位和计数器 | 生产环境推荐 |

本例采用混合策略：LLM 判断信息是否充分，同时设置最大迭代次数作为安全阀。

### 7.6.3 完整代码实现

代码文件：`research_agent.py`

```python
# 兼容
# 运行

import os
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END, add_messages
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI

# ── State 定义 ──────────────────────────────────────

MAX_ITERATIONS = 3

class ResearchState(TypedDict):
    messages: Annotated[list, add_messages]
    question: str                     # 研究问题
    search_queries: list[str]         # 搜索关键词列表
    search_results: list[dict]        # 搜索结果
    iteration_count: int              # 当前迭代次数
    is_sufficient: bool               # 信息是否充分
    final_report: str | None          # 最终报告

# ── LLM 初始化 ──────────────────────────────────────

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# ── 模拟搜索 ────────────────────────────────────────

MOCK_SEARCH_DB = {
    "RAG 技术": [
        {"title": "RAG 技术综述", "snippet": "检索增强生成（RAG）通过外部知识库提升 LLM 回答的准确性和时效性。"},
        {"title": "RAG vs Fine-tuning", "snippet": "RAG 适合知识频繁更新的场景，Fine-tuning 适合风格定制。"},
    ],
    "LangGraph 框架": [
        {"title": "LangGraph 入门指南", "snippet": "LangGraph 基于 StateGraph 构建 Agent，支持条件分支和循环。"},
        {"title": "LangGraph vs LangChain", "snippet": "LangGraph 解决了 Chain 无法表达循环和条件分支的问题。"},
    ],
    "AI Agent 架构": [
        {"title": "Agent 架构模式", "snippet": "主流 Agent 架构包括 ReAct、Plan-and-Execute 和多 Agent 协作。"},
        {"title": "Agent 安全性", "snippet": "Agent 的自主性带来安全风险，需要权限控制和输出审查。"},
    ],
    "向量数据库": [
        {"title": "向量数据库选型", "snippet": "Pinecone、Weaviate、Chroma 是主流选择，各有优劣。"},
    ],
}

def mock_search(query: str) -> list[dict]:
    """模拟搜索：关键词匹配"""
    results = []
    for key, entries in MOCK_SEARCH_DB.items():
        if any(word in query for word in key) or any(word in key for word in query):
            results.extend(entries)
    # 如果没匹配到，返回通用结果
    if not results:
        results.append({"title": "通用搜索结果", "snippet": f"关于「{query}」的信息较少，建议更换关键词。"})
    return results

# ── 节点函数 ────────────────────────────────────────

def formulate_query(state: ResearchState) -> dict:
    """生成或优化搜索关键词"""
    existing_queries = state.get("search_queries", [])
    iteration = state.get("iteration_count", 0)

    if iteration == 0:
        # 首次：直接从问题生成关键词
        system_prompt = """你是一个研究助手。根据用户的研究问题，生成2-3个最相关的搜索关键词。
每行一个关键词，不要编号，不要额外解释。"""
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"研究问题：{state['question']}"),
        ]
    else:
        # 后续
        results_summary = "\n".join(
            f"- {r['title']}: {r['snippet']}" for r in state.get("search_results", [])
        )
        system_prompt = """你是一个研究助手。根据已有的搜索结果，判断信息缺口，生成2-3个新的搜索关键词来补充缺失信息。
每行一个关键词，不要编号，不要额外解释。"""
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"研究问题：{state['question']}\n\n已有搜索结果：\n{results_summary}"),
        ]

    response = llm.invoke(messages)
    new_queries = [q.strip() for q in response.content.strip().split("\n") if q.strip()]

    return {
        "search_queries": existing_queries + new_queries,
        "iteration_count": iteration + 1,
    }


def execute_search(state: ResearchState) -> dict:
    """执行搜索"""
    # 取最新生成的一批关键词
    all_queries = state.get("search_queries", [])
    existing_count = len(state.get("search_results", []))

    # 简单估算：每批2-3个查询
    batch_size = len(all_queries) - (existing_count // 2) if existing_count > 0 else len(all_queries)
    latest_queries = all_queries[-max(batch_size, 1):]

    new_results = []
    for query in latest_queries:
        new_results.extend(mock_search(query))

    return {"search_results": state.get("search_results", []) + new_results}


def evaluate_results(state: ResearchState) -> dict:
    """评估搜索结果是否充分"""
    results_summary = "\n".join(
        f"- {r['title']}: {r['snippet']}" for r in state.get("search_results", [])
    )

    system_prompt = """你是一个研究质量评估员。判断已有的搜索结果是否足以回答研究问题。

回答格式：
- 如果信息充分，只输出 YES
- 如果信息不够，只输出 NO

判断标准：
1. 是否覆盖了问题的各个方面
2. 是否有足够的细节和深度
3. 是否存在明显的知识缺口"""

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"研究问题：{state['question']}\n\n搜索结果：\n{results_summary}"),
    ]

    response = llm.invoke(messages)
    is_sufficient = "YES" in response.content.upper()

    # 安全阀
    if state.get("iteration_count", 0) >= MAX_ITERATIONS:
        is_sufficient = True

    return {"is_sufficient": is_sufficient}


def summarize(state: ResearchState) -> dict:
    """生成研究报告"""
    results_summary = "\n".join(
        f"- {r['title']}: {r['snippet']}" for r in state.get("search_results", [])
    )

    system_prompt = """你是一个研究分析师。基于搜索结果，撰写一份结构化的研究报告。

报告格式：
1. 概述（2-3句话总结核心发现）
2. 详细分析（分点阐述，引用搜索结果）
3. 结论与建议

要求：信息准确，逻辑清晰，避免臆测。"""

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"研究问题：{state['question']}\n\n搜索结果：\n{results_summary}"),
    ]

    response = llm.invoke(messages)
    return {
        "final_report": response.content,
        "messages": [AIMessage(content=response.content)],
    }

# ── 路由函数 ────────────────────────────────────────

def should_continue(state: ResearchState) -> str:
    """判断是否继续搜索"""
    if state.get("is_sufficient", False):
        return "summarize"
    return "reformulate"

# ── 构建图 ──────────────────────────────────────────

graph = StateGraph(ResearchState)

# 添加节点
graph.add_node("formulate", formulate_query)
graph.add_node("search", execute_search)
graph.add_node("evaluate", evaluate_results)
graph.add_node("reformulate", formulate_query)  # 复用 formulate 函数，不同节点名
graph.add_node("summarize", summarize)

# 添加边
graph.add_edge(START, "formulate")
graph.add_edge("formulate", "search")
graph.add_edge("search", "evaluate")
graph.add_conditional_edges(
    "evaluate",
    should_continue,
    {
        "reformulate": "reformulate",
        "summarize": "summarize",
    },
)
graph.add_edge("reformulate", "search")  # 回到搜索 → 形成循环
graph.add_edge("summarize", END)

# 编译
app = graph.compile()

# ── 测试 ────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Research Agent 测试 ===\n")
    result = app.invoke({
        "messages": [],
        "question": "RAG 技术和 LangGraph 框架如何结合使用？",
        "search_queries": [],
        "search_results": [],
        "iteration_count": 0,
        "is_sufficient": False,
        "final_report": None,
    })

    print(f"迭代次数: {result['iteration_count']}")
    print(f"搜索关键词: {result['search_queries']}")
    print(f"搜索结果数: {len(result['search_results'])}")
    print(f"\n{'='*50}")
    print(f"研究报告:\n{result['final_report']}")

    # 打印图结构
    print(f"\n{'='*50}")
    print("图结构：")
    print(app.get_graph().draw_ascii())
```

### 7.6.3 关键设计解析

**循环图中的 Prompt 策略**

在 `formulate_query` 函数中，我们根据迭代次数使用了不同的提示词策略：第一次搜索直接从问题提取关键词，后续搜索则基于已有结果分析信息缺口。这是动态提示词注入的典型案例——**同一个节点，不同轮次使用不同的提示词模板**。

```
📌 Prompt Engineering 融入：LangGraph 中的动态 Prompt 注入

LangGraph 的 State 机制天然支持动态 Prompt：
1. 状态条件注入：根据 State 中的字段值，选择不同的提示词模板
   （如本例中 iteration_count == 0 用模板A，否则用模板B）
2. 上下文注入：将 State 中的搜索结果、对话历史等注入提示词
   （如本例中将 results_summary 放入上下文）
3. 约束注入：在提示词中明确输出格式要求
   （如 "只输出 YES 或 NO"、"每行一个关键词"）

这比 LangChain 的 PromptTemplate 更灵活——因为 State 是动态变化的，
你的 Prompt 也能跟着变。本质上，LangGraph 让 Prompt 变成了 State 的函数：
Prompt = f(State)
```

**迭代计数器的安全阀设计**

`evaluate_results` 函数中有这样一段逻辑：

```python
if state.get("iteration_count", 0) >= MAX_ITERATIONS:
    is_sufficient = True
```

这是生产环境中的必备设计——LLM 可能永远觉得"信息还不够"，导致无限循环。设置最大迭代次数就像给 Agent 的自主权加上边界，让它"从心所欲不逾矩"。

---

## 7.7 LangGraph.js（TypeScript 版本）

LangGraph 不只是 Python 的专属，它还有官方的 TypeScript 实现——`@langchain/langgraph`。如果你是前端/全栈开发者，或者需要在 Node.js 环境中运行 Agent，LangGraph.js 是你的选择。

### 7.7.1 核心概念一致

LangGraph.js 的核心概念和 Python 版完全一致——State、Node、Edge、Conditional Edge，连 API 设计都几乎同构。区别只在于语言层面的语法差异（TypeScript 的类型系统 vs Python 的 TypedDict）。

### 7.7.2 TypeScript 版客服 Agent

```typescript
// 兼容: @langchain/langgraph>=0.2.0, @langchain/openai>=0.3.0, langchain>=0.3.0
// 运行: export OPENAI_API_KEY=your-key && npx ts-node customer-service-agent.ts

import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

// ── State 定义 ──────────────────────────────────────

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
  intent: Annotation<string | null>({
    default: () => null,
  }),
  response: Annotation<string | null>({
    default: () => null,
  }),
});

type AgentStateType = typeof AgentState.State;

// ── LLM 初始化 ──────────────────────────────────────

const llm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });

// ── 模拟数据 ────────────────────────────────────────

const MOCK_ORDERS: Record<string, { product: string; price: number; status: string; daysSinceDelivery: number }> = {
  "ORD001": { product: "蓝牙耳机", price: 299, status: "delivered", daysSinceDelivery: 5 },
  "ORD002": { product: "充电宝", price: 99, status: "delivered", daysSinceDelivery: 15 },
};

// ── 节点函数 ────────────────────────────────────────

async function classifyIntent(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const systemPrompt = `你是一个意图分类器。根据用户消息判断意图类别。
只能返回以下三个类别之一：refund、inquiry、other。
只返回类别名称，不要返回其他内容。`;

  const response = await llm.invoke([
    new SystemMessage(systemPrompt),
    state.messages[state.messages.length - 1],
  ]);

  let intent = response.content.toString().trim().toLowerCase();
  if (!["refund", "inquiry", "other"].includes(intent)) {
    intent = "other";
  }

  return { intent };
}

async function handleRefund(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const userMsg = state.messages[state.messages.length - 1].content.toString();

  let orderId: string | null = null;
  for (const oid of Object.keys(MOCK_ORDERS)) {
    if (userMsg.includes(oid)) {
      orderId = oid;
      break;
    }
  }

  if (!orderId) {
    return { response: "请提供您的订单号，以便我为您查询退款信息。" };
  }

  const order = MOCK_ORDERS[orderId];
  let result: string;
  if (order.status === "delivered" && order.daysSinceDelivery <= 7) {
    result = `订单 ${orderId}（${order.product}，¥${order.price}）符合退款条件，退款将在3个工作日内原路返回。`;
  } else if (order.status !== "delivered") {
    result = `订单 ${orderId} 尚未签收，无法申请退款。`;
  } else {
    result = `订单 ${orderId} 已超过7天退货期，无法退款。`;
  }

  return { response: result };
}

async function handleInquiry(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const response = await llm.invoke([
    new SystemMessage("你是客服助手，请回答用户的咨询问题。如果无法回答，建议转人工。"),
    state.messages[state.messages.length - 1],
  ]);
  return { response: response.content.toString() };
}

async function transferHuman(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const userMsg = state.messages[state.messages.length - 1].content.toString();
  return { response: `已收到您的请求，正在转接人工客服，请稍候。` };
}

async function generateResponse(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const text = state.response || "抱歉，我暂时无法处理您的请求。";
  return { messages: [new AIMessage(text)] };
}

// ── 路由函数 ────────────────────────────────────────

function routeByIntent(state: AgentStateType): string {
  return state.intent || "other";
}

// ── 构建图 ──────────────────────────────────────────

const graph = new StateGraph(AgentState)
  .addNode("classify", classifyIntent)
  .addNode("handle_refund", handleRefund)
  .addNode("handle_inquiry", handleInquiry)
  .addNode("transfer_human", transferHuman)
  .addNode("generate_response", generateResponse)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", routeByIntent, {
    refund: "handle_refund",
    inquiry: "handle_inquiry",
    other: "transfer_human",
  })
  .addEdge("handle_refund", "generate_response")
  .addEdge("handle_inquiry", "generate_response")
  .addEdge("transfer_human", "generate_response")
  .addEdge("generate_response", END);

const app = graph.compile();

// ── 测试 ────────────────────────────────────────────

async function main() {
  console.log("=== 测试1：退款请求 ===");
  const result1 = await app.invoke({
    messages: [new HumanMessage("我要退 ORD001 的蓝牙耳机")],
  });
  console.log(`回复: ${result1.messages[result1.messages.length - 1].content}\n`);

  console.log("=== 测试2：咨询问题 ===");
  const result2 = await app.invoke({
    messages: [new HumanMessage("你们的退货政策是什么？")],
  });
  console.log(`回复: ${result2.messages[result2.messages.length - 1].content}\n`);
}

main().catch(console.error);
```

### 7.7.3 Python 与 TypeScript 的关键差异

| 方面 | Python | TypeScript |
|------|--------|-----------|
| State 定义 | `TypedDict` + `Annotated` | `Annotation.Root({...})` |
| Reducer | `add_messages` 内置函数 | 手写 `reducer: (prev, next) => ...` |
| 链式 API | 分步调用 `graph.add_node()` | 支持 `.addNode().addEdge()` 链式 |
| 异步 | 可选 async | 所有节点函数必须是 async |
| 类型推断 | TypedDict 自动推断 | `typeof Annotation.State` |

最大的感受是：TypeScript 版在 State 定义上稍显冗长（因为需要手写 Reducer），但链式 API 让图构建的代码更紧凑。两者在运行时行为上完全一致——图还是那张图，只是换了一种语言来描述。

---

## 📌 Prompt Engineering 专题：LangGraph 中的 Prompt 模板与动态注入

在整个第 7 章中，Prompt Engineering 不是独立存在的，而是渗透在图的每个节点中。让我们系统梳理一下 LangGraph 环境下的 Prompt 设计策略。

### 策略一：节点专属 Prompt

每个节点可以有自己的系统提示词，这些提示词不需要全局共享，只在各自节点生效。这让你可以为不同功能设计不同的"角色"：

```python
# 分类节点：简洁、输出受限
CLASSIFY_PROMPT = "你是意图分类器，只返回 refund/inquiry/other 之一。"

# 咨询节点：详细、知识驱动
INQUIRY_PROMPT = "你是客服助手，根据知识库信息回答问题。"

# 总结节点：结构化、分析型
SUMMARIZE_PROMPT = "你是研究分析师，撰写结构化报告。"
```

### 策略二：State 驱动的动态 Prompt

这是 LangGraph 独有的优势——Prompt 可以根据 State 动态变化：

```python
def build_prompt(state: AgentState) -> str:
    """根据当前状态动态构建提示词"""
    base = "你是一个客服助手。"

    if state.get("intent") == "refund":
        base += "\n用户正在申请退款，请核实订单信息并执行退款流程。"
    elif state.get("intent") == "inquiry":
        base += f"\n参考知识：{state.get('knowledge_result', '无')}"

    if state.get("iteration_count", 0) > 1:
        base += "\n注意：这是重复查询，请给出更具体的回答。"

    return base
```

### 策略三：输出格式约束

在 Conditional Edge 的路由函数中，LLM 的输出必须严格匹配映射表的键。因此，提示词需要明确约束输出格式：

```python
# 好的做法
"只能返回以下三个类别之一：refund、inquiry、other。只返回类别名称。"

# 不好的做法：开放式提问
"请判断用户的意图"  # LLM 可能输出各种格式，导致路由失败
```

---

## 习题

1. **为客服 Agent 添加"追问"节点**：当用户说"我要退款"但没有提供订单号时，Agent 应该追问订单号，然后回到退款处理节点。提示：这需要一个循环结构——`handle_refund` → 条件判断 → `ask_order` → `handle_refund`。

2. **为 Research Agent 添加并行搜索**：当前实现是串行搜索的。尝试用 LangGraph 的 `Send` API 实现并行搜索——同时发起多个搜索请求，结果汇总后再评估。提示：查看 LangGraph 文档中的 Map-Reduce 模式。

3. **为 Research Agent 添加检查点（Checkpointing）**：使用 `MemorySaver` 让 Research Agent 支持暂停和恢复。提示：`graph.compile(checkpointer=MemorySaver())`，然后用不同的 `thread_id` 管理会话。

## 参考文献

1. LangGraph Documentation. https://langchain-ai.github.io/langgraph/
2. LangGraph.js Documentation. https://langchain-ai.github.io/langgraphjs/

## 开放讨论

1. **Chain vs Graph 的选择边界**：并非所有 Agent 都需要图结构。什么情况下你应该坚持使用简单的 Chain，而不是"杀鸡用牛刀"上 LangGraph？谈谈你的判断标准。

2. **循环图的退出困境**：Research Agent 中我们用了迭代计数器作为安全阀。但在实际应用中，LLM 可能前两轮就说"信息充分了"（其实并不充分），也可能一直说"还不够"（其实已经够了）。你有什么更好的退出策略？

3. **State 膨胀问题**：随着图中节点增多，State 的字段也会越来越多。当 State 包含几十个字段时，代码的可维护性会急剧下降。你有什么设计策略来控制 State 的复杂度？

---
