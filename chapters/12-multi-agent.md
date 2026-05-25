# 第12章 多智能体协作

> 君子和而不同，小人同而不和。——《论语·子路》

单个 Agent 再强，也不过是"一夫之勇"。现实中的复杂任务——开发一款软件、分析一份数据、运营一家公司——从来都不是一个人能搞定的，而是一个团队协作的结果。多智能体协作（Multi-Agent Collaboration）就是让多个 Agent 像人类团队一样分工配合。但这里有一个根本性的挑战：Agent 之间的协作靠什么？如何让它们不"撞车"、不"各说各话"、不"互相拆台"？本章将从多 Agent 系统的编排模式出发，带你掌握 LangGraph 的三种编排模式（Supervisor / Swarm / Hierarchical）和 Agent 间通信机制，学会设计角色提示词实现 Agent 分工协作，并通过软件开发团队 Agent 和数据分析流水线两个实战项目把理论付诸实践。

---

## 12.1 多 Agent 系统的设计模式

设计多 Agent 系统之前，首先要回答一个根本问题：这些 Agent 之间是什么关系？谁来指挥谁？谁和谁平级？这个问题不解决，后面的一切都无从谈起。

### 12.1.1 三种组织结构

从人类社会组织的经验来看，团队的结构无非三种：人人平等、有人说了算、小组自治。多 Agent 系统也一样。

**对等结构（Peer-to-Peer）**

所有 Agent 地位平等，没有"领导"，通过协商达成一致。适合创意讨论、辩论、投票等场景。

```
对等结构（Peer-to-Peer）：

         ┌──────────┐
    ┌────│ Agent A  │────┐
    │    └──────────┘    │
    │                    │
    ▼                    ▼
┌──────────┐      ┌──────────┐
│ Agent C  │──────│ Agent B  │
└──────────┘      └──────────┘

特点：无中心节点，Agent 间直接通信
适用：辩论、投票、头脑风暴
风险：容易陷入僵局，无仲裁机制
```

**层级结构（Hierarchical）**

有一个中心 Agent（Supervisor）负责指挥和协调，其他 Agent 汇报给它。适合流程化的任务，如软件开发流水线、审批流程。

```
层级结构（Hierarchical）：

            ┌──────────────┐
            │  Supervisor   │
            └──────┬───────┘
                   │
         ┌─────────┼─────────┐
         ▼         ▼         ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ Agent A │ │ Agent B │ │ Agent C │
    └─────────┘ └─────────┘ └─────────┘
         ▲                   │
         └───────────────────┘
           (A 向 Supervisor 汇报，
            Supervisor 决定下一步)

特点：中心化控制，流程清晰
适用：流水线任务、审批流程
风险：Supervisor 成为瓶颈
```

**联邦结构（Federated）**

多个小组，每组有自己的 Supervisor，组间再通过上层 Supervisor 协调。适合大规模、多层次的系统。

```
联邦结构（Federated）：

              ┌──────────────┐
              │  Top Supervisor│
              └──────┬───────┘
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
    ┌──────────────┐    ┌──────────────┐
    │ Sub-Supervisor│    │ Sub-Supervisor│
    └──────┬───────┘    └──────┬───────┘
           │                   │
     ┌─────┼─────┐       ┌────┼────┐
     ▼     ▼     ▼       ▼    ▼    ▼
    A1    A2    A3      B1   B2   B3

特点：分组自治，上层协调
适用：大规模系统、多部门协作
风险：层间通信延迟，设计复杂
```

三种结构不是互斥的——同一个系统中可以混合使用。比如一个联邦结构的系统，每个小组内部可能是层级结构，而组间通过上层 Supervisor 以对等方式协商。

### 12.1.2 四种设计模式

组织结构解决了"谁听谁的"问题，设计模式解决"怎么干活"的问题。以下是四种常见的多 Agent 协作模式。

**1. 路由模式（Routing）**

一个"前台"Agent 接收请求，根据内容路由到最合适的专业 Agent 处理。就像医院的分诊台——你先到分诊台，分诊台根据你的症状把你分配到内科、外科或眼科。

```
路由模式（Routing）：

     ┌──────────┐
     │  Router   │ ← 分析请求，决定路由
     └────┬─────┘
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 ┌─────┐┌─────┐┌─────┐
 │专家A ││专家B ││专家C │
 └──┬──┘└──┬──┘└──┬──┘
    │       │       │
    └───────┼───────┘
            ▼
        最终结果

典型场景：客服系统（路由到退款/咨询/投诉）
```

**2. 流水线模式（Pipeline）**

任务按固定顺序经过多个 Agent，每个 Agent 完成自己的环节后传给下一个。就像工厂的流水线——焊接→喷漆→组装，每道工序只做自己那部分。

```
流水线模式（Pipeline）：

┌──────────┐    ┌──────────┐    ┌──────────┐
│ Agent A  │───→│ Agent B  │───→│ Agent C  │
│ (需求分析)│    │ (代码编写)│    │ (测试验证)│
└──────────┘    └──────────┘    └──────────┘

特点：顺序固定，单向流转
适用：软件开发、内容审核流水线
风险：某环节阻塞，整条线停滞
```

**3. 辩论模式（Debate）**

多个 Agent 对同一问题提出各自的方案，通过辩论和投票选出最优解。就像评审会——不同专家各抒己见，最终投票决策。

```
辩论模式（Debate）：

     ┌──────────┐
     │  主持人   │ ← 提出问题
     └────┬─────┘
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 ┌─────┐┌─────┐┌─────┐
 │正方A ││反方B ││评审C │
 └──┬──┘└──┬──┘└──┬──┘
    │  ←→   │       │
    │  辩论  │  ←→   │
    └───────┼───────┘
            ▼
        投票/综合 → 最终方案

特点：多视角碰撞，减少盲点
适用：方案评审、风险评估
风险：可能陷入无休止争论
```

**4. 协作生成模式（Collaborative Generation）**

多个 Agent 共同完成一个产出，每个 Agent 负责不同的部分，最后合并。就像合作写一本书——有人写第一章，有人写第二章，最后统稿。

```
协作生成模式（Collaborative Generation）：

     ┌──────────┐
     │  协调者   │ ← 拆分任务
     └────┬─────┘
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 ┌─────┐┌─────┐┌─────┐
 │Agent ││Agent ││Agent │
 │ 部分A ││ 部分B ││ 部分C │
 └──┬──┘└──┬──┘└──┬──┘
    │       │       │
    └───────┼───────┘
            ▼
     ┌──────────┐
     │  整合者   │ ← 合并产出
     └──────────┘

特点：并行工作，效率高
适用：报告撰写、多语言翻译
风险：整合困难，风格不统一
```

实际项目中，这些模式往往组合使用。比如一个软件开发团队可能先走流水线（需求→编码→测试），测试不通过时退回编码（循环），需求不明确时多个产品经理辩论（辩论模式）。设计多 Agent 系统，就像设计组织架构——没有万能模板，只有适合场景的方案。

> 古语点睛：**"君子和而不同"**——好的多 Agent 系统也是如此。Agent 之间不必"同"（用同样的方式思考），但必须"和"（协调一致地完成任务）。多样性带来鲁棒性，协调性保证效率。

---

## 12.2 LangGraph 的多 Agent 模式

LangGraph 提供了三种官方推荐的多 Agent 编排模式：Supervisor、Swarm 和 Hierarchical。

### 12.2.1 Supervisor 模式

Supervisor 是最经典的多 Agent 模式——一个中心 Agent 负责接收请求、分配任务、收集结果。其他 Agent 只与 Supervisor 通信，彼此之间不直接对话。

```
Supervisor 模式：

              ┌──────────────┐
              │  Supervisor   │
              │  (路由+协调)   │
              └──┬───┬───┬───┘
                 │   │   │
          ┌──────┘   │   └──────┐
          ▼          ▼          ▼
     ┌─────────┐┌─────────┐┌─────────┐
     │ Agent A ││ Agent B ││ Agent C │
     └─────────┘└─────────┘└─────────┘

流程：用户 → Supervisor → 选择 Agent → 执行 → 回到 Supervisor → ...
```

在 LangGraph 中实现 Supervisor 模式的核心是**条件路由（Conditional Edge）**——Supervisor 节点根据当前状态决定下一个执行的 Agent：

```python
from langgraph.graph import StateGraph, START, END
from typing import TypedDict, Literal

class AgentState(TypedDict):
    messages: list
    next_agent: str

# Supervisor 节点
def supervisor_node(state: AgentState) -> dict:
    # LLM 分析当前状态，决定下一步交给谁
    next_agent = route_to_agent(state)  # 路由逻辑
    return {"next_agent": next_agent}

# 条件路由
workflow.add_conditional_edges(
    "supervisor",
    lambda state: state["next_agent"],
    {
        "agent_a": "agent_a",
        "agent_b": "agent_b",
        "agent_c": "agent_c",
        "FINISH": END,
    },
)
```

Supervisor 模式的优点是**简单可控**——所有决策集中在一点，逻辑清晰，调试方便。缺点是 Supervisor 可能成为瓶颈——所有 Agent 的输出都要经过它，当 Agent 数量多或交互频繁时，Supervisor 的 LLM 调用次数会激增。

### 12.2.2 Swarm 模式

Swarm 是 OpenAI 提出的一种去中心化模式——没有固定的 Supervisor，每个 Agent 执行完后自己决定把控制权交给谁。就像一群蜜蜂，没有"蜂王"指挥每一步，但每只蜜蜂都知道自己的下一步该做什么。

```
Swarm 模式：

┌─────────┐     ┌─────────┐     ┌─────────┐
│ Agent A │────→│ Agent B │────→│ Agent C │
└─────────┘     └─────────┘     └─────────┘
     ▲                               │
     └───────────────────────────────┘
     (每个 Agent 自行决定交接对象)

核心：Agent 通过 handoff 工具将控制权交给下一个 Agent
```

Swarm 的关键机制是 **handoff（交接）**——每个 Agent 的工具列表中包含一个特殊的"交接工具"，调用它就可以把控制权转给另一个 Agent：

```python
from langchain_core.tools import tool

@tool
def transfer_to_agent_b(context: str) -> str:
    """将控制权交给 Agent B。
    当你需要 Agent B 处理后续任务时调用此工具。"""
    return f"已交接给 Agent B，上下文：{context}"

# Agent A 的工具列表包含 handoff 工具
agent_a_tools = [do_something, transfer_to_agent_b]
```

Swarm 模式的优点是**灵活**——不需要预先定义完整的路由逻辑，Agent 根据执行结果动态决定下一步。缺点是**可控性较弱**——如果 Agent 的交接决策出错，可能陷入循环或跳过关键步骤。

### 12.2.3 Hierarchical 模式

Hierarchical 是 Supervisor 模式的升级版——多层 Supervisor 嵌套，形成树状结构。顶层 Supervisor 负责宏观调度，子 Supervisor 负责微观执行。就像公司的组织架构——CEO 管部门总监，总监管团队 Lead，Lead 管工程师。

```
Hierarchical 模式：

              ┌──────────────┐
              │ Top Supervisor│
              └──────┬───────┘
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
    ┌──────────────┐    ┌──────────────┐
    │ Sub-Supervisor│    │ Sub-Supervisor│
    │  (研发团队)   │    │  (运维团队)   │
    └──────┬───────┘    └──────┬───────┘
           │                   │
     ┌─────┼─────┐       ┌────┼────┐
     ▼     ▼     ▼       ▼    ▼    ▼
    Dev1  Dev2  Tester  Ops1 Ops2  SRE

每层 Supervisor 只管理自己的子 Agent，
无需了解全局细节
```

在 LangGraph 中实现 Hierarchical 模式，本质上是**子图的组合**——每个子团队是一个独立的 StateGraph，顶层图通过节点引用子图：

```python
# 子团队图（如研发团队）
dev_team_graph = StateGraph(DevTeamState)
dev_team_graph.add_node("supervisor", dev_supervisor_node)
dev_team_graph.add_node("developer", developer_node)
dev_team_graph.add_node("tester", tester_node)
# ... 添加边和路由逻辑
dev_team_app = dev_team_graph.compile()

# 顶层图
top_graph = StateGraph(TopState)
top_graph.add_node("top_supervisor", top_supervisor_node)
top_graph.add_node("dev_team", dev_team_app)  # 子图作为节点
top_graph.add_node("ops_team", ops_team_app)   # 子图作为节点
# ... 添加边和路由逻辑
```

Hierarchical 模式的核心优势是**可扩展性**——随着 Agent 数量增长，你只需要增加子团队，而不需要修改顶层逻辑。缺点是**调试复杂**——问题可能出在任何一层，追踪跨层的交互需要深入多层子图。

### 12.2.4 三种模式对比

```
┌───────────────┬───────────────────┬───────────────────┬───────────────────┐
│    维度        │    Supervisor      │    Swarm           │    Hierarchical   │
├───────────────┼───────────────────┼───────────────────┼───────────────────┤
│  控制方式      │ 中心化             │ 去中心化            │ 分层中心化         │
│  决策者        │ Supervisor 独占    │ 各 Agent 自主      │ 各层 Supervisor   │
│  Agent 间通信  │ 必须经过 Supervisor│ 直接交接（handoff） │ 层内直接，层间上级 │
│  可扩展性      │ 中（Supervisor 瓶颈）│ 高（无中心瓶颈）  │ 高（按层扩展）     │
│  可控性        │ 高                 │ 中                 │ 高                │
│  调试难度      │ 低（集中式）        │ 中（需追踪交接链）  │ 高（多层嵌套）     │
│  适用场景      │ 流水线、审批流程    │ 开放式协作          │ 大型组织、企业系统 │
│  Agent 数量    │ 3-10               │ 2-5                │ 10+               │
└───────────────┴───────────────────┴───────────────────┴───────────────────┘

选型建议：
  - 小团队、流程明确 → Supervisor
  - Agent 平等协作、动态交接 → Swarm
  - 大规模、多层次 → Hierarchical
  - 不确定？从 Supervisor 开始，按需演进
```

从 Supervisor 开始。它是最简单、最可控的模式，适合 80% 的场景。当你发现 Supervisor 确实成为瓶颈时，再考虑 Swarm 或 Hierarchical。过早引入复杂架构，只会让系统更难调试和维护。

---

## 12.3 Agent 间通信

多 Agent 系统的协作效果，很大程度上取决于 Agent 之间如何通信。通信机制不仅影响系统的正确性，还影响可扩展性和可调试性。

### 12.3.1 共享状态（Shared State）

所有 Agent 读写同一块共享数据，通过状态变化来协调行为。LangGraph 的 `State` 就是典型的共享状态机制。

```
共享状态通信：

┌──────────────────────────────────────────────┐
│              Shared State                     │
│  ┌─────────────────────────────────────────┐ │
│  │ messages: [...]                          │ │
│  │ requirements: "..."                      │ │
│  │ code_output: "..."                       │ │
│  │ test_results: "..."                      │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│   Agent A (写) ──→ State ──→ Agent B (读)     │
│   Agent C (写) ──→ State ──→ Agent D (读)     │
└──────────────────────────────────────────────┘

特点：Agent 不直接对话，通过"留言板"间接通信
```

在 LangGraph 中，State 使用 `TypedDict` 定义，每个 Agent 节点返回需要更新的字段：

```python
class TeamState(TypedDict):
    messages: Annotated[list, add_messages]  # 对话历史（追加而非覆盖）
    requirements: str      # 需求文档
    code_output: str       # 代码产出
    test_results: str      # 测试结果
    next_agent: str        # 下一个执行的 Agent
    iteration: int         # 当前迭代轮次
```

共享状态的关键设计是 **reducer 函数**——它定义了多个 Agent 写入同一字段时的合并策略。`add_messages` 是 LangGraph 内置的 reducer，它将新消息追加到列表而非覆盖。对于其他字段（如 `requirements`），默认策略是后写覆盖（last-write-wins），这在流水线模式中是合理的——产品经理写需求，程序员读需求，不会产生冲突。

### 12.3.2 消息传递（Message Passing）

Agent 之间直接发送消息，每个 Agent 拥有独立的信箱。AutoGen 框架采用的就是消息传递模式。

```
消息传递通信：

┌─────────┐   message   ┌─────────┐   message   ┌─────────┐
│ Agent A │─────────────→│ Agent B │─────────────→│ Agent C │
│         │              │         │              │         │
│ inbox:[]│              │ inbox:[msg]│           │ inbox:[msg]│
└─────────┘              └─────────┘              └─────────┘

特点：Agent 间直接对话，每个 Agent 有独立信箱
```

消息传递的优势是**解耦**——Agent 只需要知道消息的格式，不需要知道其他 Agent 的内部状态。这在 Agent 动态加入/退出的场景中特别有用。缺点是**消息风暴**——如果 Agent 数量多且交互频繁，消息量可能指数级增长，需要设计消息过滤和优先级机制。

### 12.3.3 混合模式

在实际项目中，共享状态和消息传递往往混合使用：通过共享状态传递结构化数据（需求文档、代码、测试结果），通过消息传递触发行为（"请开始编码"、"测试不通过，请修改"）。

```
混合通信模式：

  ┌──────────────────────────────────────────┐
  │           Shared State                    │
  │  requirements | code | test_results      │
  └────────┬──────────────────────┬──────────┘
           │                      │
    Agent A (写需求)          Agent C (写测试结果)
           │                      │
           └── message ──────────→┘
           "需求已就绪，请编码"

  结构化数据走共享状态，行为触发走消息
```

### 12.3.4 三种通信机制对比

```
┌──────────────┬──────────────────┬──────────────────┬──────────────────────┐
│    维度       │    共享状态       │    消息传递        │    混合模式           │
├──────────────┼──────────────────┼──────────────────┼──────────────────────┤
│  耦合度       │ 高（共享数据结构） │ 低（只依赖消息格式）│ 中                  │
│  一致性       │ 强（单一数据源）   │ 弱（需额外同步）   │ 强（状态+消息配合）  │
│  可扩展性     │ 中（状态膨胀风险） │ 高（解耦天然可扩） │ 高                  │
│  调试难度     │ 低（集中查看状态） │ 中（追踪消息链）   │ 中                  │
│  典型框架     │ LangGraph        │ AutoGen           │ LangGraph + 自定义  │
│  适用场景     │ 流水线、紧密协作   │ 松耦合、动态拓扑   │ 复杂系统            │
└──────────────┴──────────────────┴──────────────────┴──────────────────────┘

实践建议：
  - 用 LangGraph？默认用共享状态
  - Agent 间需要松耦合？在共享状态基础上增加消息触发
  - 不要过早优化通信机制——先跑通，再根据瓶颈调整
```

一个常见的误区是过度追求通信架构的完善。实际上，对于大多数项目来说，LangGraph 的共享状态已经足够。当你真正遇到状态冲突或扩展瓶颈时，再引入消息传递机制也不迟。先让它跑起来，再让它跑得好。

---

## 12.4 Deep Agents 框架实战

Deep Agents 是 LangChain 团队推出的开源自主 Agent 框架，我们在第 3 章已经介绍过它的设计哲学——"意见即效率"。如果说 LangGraph 是引擎，Deep Agents 就是整车。它内置了子 Agent、文件系统、上下文管理、持久化记忆等能力，让开发者用最少的代码构建真正能"自己跑起来"的自主 Agent。

### 12.4.1 Deep Agents 在多 Agent 系统中的定位

在多 Agent 协作的语境下，Deep Agents 提供了一种独特的能力——**子 Agent（Sub-agents）**。与 LangGraph 的 Supervisor/Swarm 模式不同，Deep Agents 的子 Agent 是"嵌入式"的——主 Agent 可以将子任务委派给独立的子 Agent，每个子 Agent 拥有独立的上下文窗口，不会污染主对话。

```
Deep Agents 的子 Agent 模型：

┌────────────────────────────────────────────┐
│              主 Agent (Deep Agent)          │
│                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 子Agent A │  │ 子Agent B │  │ 子Agent C │ │
│  │独立上下文 │  │独立上下文 │  │独立上下文 │ │
│  │独立工具集 │  │独立工具集 │  │独立工具集 │ │
│  └──────────┘  └──────────┘  └──────────┘ │
│                                            │
│  技能: data_collection, analysis, report   │
│  文件系统: 本地/沙箱/远程                     │
│  记忆: 跨会话持久化                           │
└────────────────────────────────────────────┘
```

这种模型的好处是**隔离性**——每个子 Agent 的"脑子"是独立的，不会因为处理某个子任务而把主 Agent 的上下文窗口撑爆。代价是**通信开销**——子 Agent 的结果需要"摘要"后传回主 Agent，信息可能有损。

### 12.4.2 Deep Agents 核心能力速览

| 能力 | 说明 | 多 Agent 场景价值 |
|------|------|-------------------|
| 子 Agent | 主 Agent 委派子任务给独立 Agent | 任务分解、上下文隔离 |
| 文件系统 | 内置文件读写/编辑/搜索 | Agent 间通过文件交换数据 |
| 上下文管理 | 自动摘要、溢出到磁盘 | 长对话不爆窗口 |
| 持久化记忆 | 跨会话状态存储 | Agent 记住历史协作结果 |
| 技能（Skills） | 可复用的行为模块 | 按需加载，灵活组合 |
| 人机协作 | 工具调用的审批/编辑/拒绝 | 关键节点人工把关 |

### 12.4.3 与 LangGraph 的关系

Deep Agents 构建在 LangGraph 之上——底层仍然是 State / Node / Edge 那套图运行时。区别在于，Deep Agents 在上层封装了更多"开箱即用"的能力，你不需要自己实现上下文管理、文件系统、记忆持久化等基础设施。

```
技术栈关系：

  LangGraph（图运行时，最底层）
    └── create_agent（轻量 Agent 框架，中间层）
          └── Deep Agents（全功能自主 Agent 框架，最高层）

  三者共享同一套基础构建块，但每一层封装了更多能力。
  你可以根据需求选择合适的抽象层。
```

如果你需要精细控制工作流（如条件分支、循环、状态流转），用 LangGraph；如果你需要快速构建一个能自主运行的 Agent，用 Deep Agents；如果你只需要一个简单的对话 Agent，用 `create_agent`。

---

## 12.5 实战

理论讲够了，现在动手。动手之前先提两个在实践中极易踩坑的地方：一是下游 Agent 收不到上游 Agent 的完整输出——State 中的消息字段被覆盖而非追加，导致上下文断裂，需要用 `operator.add` 注解实现追加；二是 Supervisor 在 Agent 之间反复切换，形成"你来做→你来做→还是你来做"的死循环，需要为 Supervisor 设置最大切换次数限制，并在提示词中明确"当任务完成时必须输出 FINISH"。本章用 LangGraph 构建一个软件开发团队——产品经理分析需求，程序员编写代码，测试工程师验证结果，Supervisor 协调整个流程。完整代码见 `software_team.py`。

### 12.5.1 系统架构

```
软件开发团队架构（Supervisor 模式）：

用户需求
   │
   ▼
┌──────────────┐
│  Supervisor   │ ← 协调工作流程
└──┬───┬───┬───┘
   │   │   │
   ▼   │   ▼
┌─────────┐  ┌─────────┐
│产品经理  │  │测试工程师│
│分析需求  │  │验证代码  │
└────┬────┘  └────┬────┘
     │            │
     ▼            │ 不通过
┌─────────┐       │
│ 程序员   │◄──────┘
│ 编写代码 │
└────┬────┘
     │
     ▼
  通过 → 结束

流程：需求分析 → 编码 → 测试 → (通过/退回修改)
```

### 12.5.2 角色提示词设计

多 Agent 系统中，每个 Agent 的角色提示词（System Prompt）直接决定了它的行为边界。提示词设计有几个关键原则：

1. 身份明确——告诉 Agent "你是谁"，它才知道自己该做什么、不该做什么。产品经理不写代码，测试工程师不修改代码，这些边界必须在提示词中明确声明。

2. 能力界定——列出 Agent "能做什么"和"不能做什么"。正面的能力描述指导行为，负面的约束防止越界。

3. 输出格式约束——要求 Agent 按固定格式输出，方便下游 Agent 解析。需求文档要结构化，代码要包在代码块里，测试报告要有明确的"通过/不通过"结论。

来看产品经理的提示词设计：

```python
PRODUCT_MANAGER_PROMPT = """你是一位经验丰富的产品经理。

## 你的身份
你负责分析用户需求，将其转化为清晰的技术需求文档。

## 你的能力
- 将模糊的用户需求拆解为具体的功能点
- 为每个功能点定义验收标准
- 评估需求的优先级和可行性

## 你的约束
- 你不写代码，只负责需求分析
- 你需要输出结构化的需求文档
- 如果需求不明确，你需要提出澄清问题

## 输出格式
请按以下格式输出需求文档：
### 需求概述
[一句话概括]

### 功能点列表
1. [功能点1] - 优先级: [高/中/低]
   - 描述: [详细描述]
   - 验收标准: [可验证的标准]
2. ...
"""
```

这段提示词的精妙之处在于**身份-能力-约束-格式**的四段式结构。身份定义角色，能力定义"能做什么"，约束定义"不能做什么"，格式定义"怎么输出"。这四个维度缺一不可——没有身份，Agent 不知道自己的立场；没有能力，Agent 不知道该做什么；没有约束，Agent 可能越界；没有格式，下游 Agent 无法解析输出。

程序员和测试工程师的提示词遵循同样的四段式结构，参见 `software_team.py` 中的 `DEVELOPER_PROMPT` 和 `TESTER_PROMPT`。

### 12.5.3 共享状态设计

```python
class TeamState(TypedDict):
    """软件开发团队的共享状态"""
    messages: Annotated[list, add_messages]  # 对话历史
    user_request: str      # 用户原始需求
    requirements: str      # 产品经理输出的需求文档
    code_output: str       # 程序员输出的代码
    test_results: str      # 测试工程师输出的测试报告
    next_agent: str        # 下一个执行的 Agent
    iteration: int         # 当前迭代轮次（用于控制重试次数）
```

这个状态设计有几个值得注意的细节：

- `messages` 使用 `add_messages` reducer，确保对话历史是追加而非覆盖，保留完整的协作轨迹。
- `iteration` 记录当前迭代轮次，防止测试不通过时无限退回程序员修改。最多允许 2 轮修改，超过则强制结束——这是多 Agent 系统中常见的"熔断"机制。
- `next_agent` 由 Supervisor 写入，条件路由读取，实现了控制流和数据流的解耦。

### 12.5.4 工作流构建

```python
def build_workflow() -> StateGraph:
    workflow = StateGraph(TeamState)

    # 添加节点
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("product_manager", product_manager_node)
    workflow.add_node("developer", developer_node)
    workflow.add_node("tester", tester_node)

    # 设置入口
    workflow.add_edge(START, "supervisor")

    # Agent 执行完毕后回到 Supervisor
    workflow.add_edge("product_manager", "supervisor")
    workflow.add_edge("developer", "supervisor")
    workflow.add_edge("tester", "supervisor")

    # Supervisor 的条件路由
    workflow.add_conditional_edges(
        "supervisor",
        lambda state: state["next_agent"],
        {
            "product_manager": "product_manager",
            "developer": "developer",
            "tester": "tester",
            "FINISH": END,
        },
    )
    return workflow
```

注意一个关键设计：所有 Agent 执行完毕后都回到 Supervisor，而不是直接传给下一个 Agent。这确保了 Supervisor 对全局流程的掌控——每一步的去向都由它决定，而不是由 Agent 自行交接。这正是 Supervisor 模式与 Swarm 模式的核心区别。

### 12.5.5 运行说明

```bash
# 安装依赖
pip install -r requirements.txt

# 运行（使用 Mock LLM，无需 API Key）
python software_team.py
```

代码使用 Mock LLM 模拟大模型响应，无需配置 API Key 即可运行。Mock LLM 精心设计了多轮交互：第一轮测试会发现 Bug（错误消息不够明确），退回程序员修改；第二轮测试全部通过，流程结束。这模拟了真实的"编码→测试→修改→再测试"循环。

---

## 12.6 实战

软件开发团队是 Supervisor 模式的典型应用，数据分析流水线则展示了另一种多 Agent 协作方式——**流水线 + 自我反思**。

### 12.6.1 从 Deep Agents 理念出发

Deep Agents 的核心理念是：Agent 应该具备自主性——它能自己决定下一步做什么，自己反思结果质量，自己决定是否返工。我们将用 LangGraph 实现 Deep Agents 的这一理念，构建一个数据分析流水线，包含数据采集、清洗、分析、报告生成和质量反思五个环节。

```
数据分析流水线架构：

┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 数据采集  │──→│ 数据清洗  │──→│ 数据分析  │──→│ 报告生成  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                    │
                                              ┌──────────┐
                                              │ 质量反思  │
                                              └────┬─────┘
                                                   │
                                          ┌────────┴────────┐
                                          ▼                 ▼
                                     质量达标           质量不达标
                                       │                 │
                                       ▼                 ▼
                                      结束           返回"分析"重做
```

关键创新点是**质量反思节点**——它评估报告的质量，如果不够好（比如洞察数量不足），就退回"数据分析"节点重新分析。这模拟了 Deep Agents 的"自我反思"能力：Agent 不仅是被动执行，还能主动评估自己的产出质量。

### 12.6.2 核心代码

完整代码见 `deepagent_pipeline.py`。这里重点解读流水线的图结构构建：

```python
def build_pipeline():
    workflow = StateGraph(PipelineState)

    workflow.add_node("collect", data_collect_node)
    workflow.add_node("clean", data_clean_node)
    workflow.add_node("analyze", data_analyze_node)
    workflow.add_node("report", report_node)
    workflow.add_node("reflect", reflect_node)

    workflow.add_edge(START, "collect")
    workflow.add_edge("collect", "clean")
    workflow.add_edge("clean", "analyze")
    workflow.add_edge("analyze", "report")
    workflow.add_edge("report", "reflect")
    workflow.add_conditional_edges(
        "reflect",
        should_refine,
        {"refine": "analyze", "done": END},
    )
    return workflow.compile()
```

这段代码的结构清晰：前四个节点是线性流水线，`reflect` 节点是分叉点——质量达标则结束，不达标则退回 `analyze` 重新分析。注意退回的是 `analyze` 而非 `collect`——如果数据本身没问题，只是分析不够深入，没必要重新采集数据。这种"退回最近的问题节点"的策略，比"从头再来"更高效。

### 12.6.3 运行说明

```bash
pip install -r requirements.txt
python deepagent_pipeline.py
```

代码同时包含 Deep Agents SDK 的概念性用法（`create_data_analysis_agent_sdk()`）和 LangGraph 的替代实现。前者展示了 Deep Agents 的理想 API 风格，后者是可以直接运行的完整实现。

---

## 12.7 TypeScript 多 Agent 实战

前端和全栈开发者更熟悉 TypeScript。本节我们用纯 TypeScript 实现一个与 12.5 节相同架构的软件开发团队，让你看到多 Agent 系统不依赖任何特定框架的核心逻辑。完整代码见 `ts/ch12/`。

### 12.7.1 类型系统设计

TypeScript 的类型系统在多 Agent 开发中是一个重要优势——你可以用接口精确描述每个 Agent 的行为契约，编译器会在编译期捕获类型错误，而不是在运行时才发现"这个 Agent 的输出格式不对"。

```typescript
// types.ts
export interface AgentMessage {
  role: string;
  content: string;
  timestamp: number;
}

export interface AgentState {
  messages: AgentMessage[];
  currentTask: string;
  assignedAgent: string | null;
  result: string | null;
  iteration: number;
  nextAgent: string;
}

export interface Agent {
  name: string;
  role: string;
  systemPrompt: string;
  process(state: AgentState): Promise<AgentState>;
}
```

`Agent` 接口是整个系统的核心契约——任何 Agent 只要有 `name`、`role`、`systemPrompt` 和 `process` 方法，就可以注册到 Supervisor 中。这种"面向接口编程"的设计，让新增 Agent 只需要实现接口，不需要修改 Supervisor 的代码。

### 12.7.2 Supervisor 编排器

```typescript
// supervisor.ts
export class Supervisor {
  private agents: Map<string, Agent> = new Map();
  private maxIterations: number;

  registerAgent(agent: Agent): void {
    this.agents.set(agent.name, agent);
  }

  private route(state: AgentState): string {
    if (state.nextAgent) return state.nextAgent;
    // 根据任务关键词路由
    const task = state.currentTask.toLowerCase();
    if (task.includes("需求") || task.includes("分析"))
      return "product_manager";
    if (task.includes("编码") || task.includes("实现"))
      return "developer";
    if (task.includes("测试") || task.includes("验证"))
      return "tester";
    return "product_manager";
  }

  async execute(initialState: AgentState): Promise<AgentState> {
    let state = { ...initialState };
    let totalIterations = 0;

    while (totalIterations < this.maxIterations) {
      const agentName = this.route(state);
      if (agentName === "FINISH") break;

      const agent = this.agents.get(agentName);
      if (!agent) break;

      state = await agent.process(state);
      totalIterations++;
    }
    return state;
  }
}
```

TypeScript 版本的 Supervisor 比 Python 版更轻量——它没有使用 LangGraph.js 的图抽象，而是用一个简单的 while 循环实现了 Supervisor 模式的核心逻辑。这帮你理解一个关键点：框架只是工具，模式才是本质。 Supervisor 模式不依赖 LangGraph，用任何语言、任何框架都能实现。

### 12.7.3 运行说明

```bash
cd ts/ch12
npm install
npx ts-node index.ts
```

项目结构：

```
ts/ch12/
├── types.ts        # 类型定义
├── agents.ts       # Agent 实现（产品经理/程序员/测试工程师）
├── supervisor.ts   # Supervisor 编排器
├── index.ts        # 入口文件
├── package.json
└── tsconfig.json
```

---

## 📌 Prompt Engineering 融入：多 Agent 协作中的角色提示词设计

多 Agent 系统中，提示词不仅是"给 LLM 的指令"，更是**Agent 间的契约**。一个 Agent 的输出格式，决定了下游 Agent 能否正确理解和使用这些信息。提示词设计不当，整个协作链条就会断裂。

### 角色提示词的四段式模板

```
## 你的身份
[你是谁，你的角色定位]

## 你的能力
- [能力1]
- [能力2]
- ...

## 你的约束
- [约束1]
- [约束2]
- ...

## 输出格式
[结构化的输出模板，确保下游 Agent 可解析]
```

### 多 Agent 提示词设计的三条黄金法则

法则一：边界比能力更重要。

很多开发者热衷于给 Agent 塞更多能力，却忽视了约束。在多 Agent 系统中，越界的危害远大于无能——如果产品经理自己写了代码，程序员的工作就被架空了；如果测试工程师直接修改了代码，整个质量保证流程就形同虚设。**约束是护栏，不是枷锁。**

```
反面案例：
"你是一个产品经理，你需要分析需求并给出实现建议。"
→ Agent 可能越界写代码

正面案例：
"你是一个产品经理。你不写代码，只负责需求分析。"
→ 边界清晰，不会越界
```

法则二：输出格式是 Agent 间的协议。

在流水线模式中，上游 Agent 的输出就是下游 Agent 的输入。输出格式不稳定，下游 Agent 就无法解析。因此在提示词中用固定的标题、编号、结构来约束输出格式，就像 API 设计中定义清晰的 JSON Schema 一样。

```
## 输出格式
### 需求概述
[一句话概括]

### 功能点列表
1. [功能点] - 优先级: [高/中/低]
   - 验收标准: [可验证的标准]
```

法则三：角色定位决定推理方向。

同一个 LLM，不同的角色提示词会产出完全不同的回答。"你是一个产品经理"会让 LLM 从用户价值角度思考，"你是一个测试工程师"会让它从边界条件和异常情况思考。这种"视角切换"是多 Agent 系统的核心价值——多个视角的碰撞，比单一视角的深度更有价值。

### 提示词冲突与仲裁

多 Agent 系统中可能出现提示词冲突——两个 Agent 对同一问题给出了矛盾的建议。解决方案：

1. 在 Supervisor 的提示词中定义仲裁规则——"当产品经理和程序员意见冲突时，以产品经理的需求定义为准"
2. 在共享状态中记录决策理由——让后续 Agent 理解为什么做了这个选择
3. 使用辩论模式解决根本分歧——让双方 Agent 陈述理由，由 Supervisor 或第三方 Agent 裁决

---

## 进阶必做

1. **扩展软件开发团队**：在 `software_team.py` 的基础上，增加一个"代码审查员"Agent，在程序员和测试工程师之间加入代码审查环节。要求：定义代码审查员的提示词和输出格式，修改 Supervisor 的路由逻辑，增加代码审查的状态字段。观察增加代码审查后，测试通过率是否提升。

2. **实现 Swarm 模式的交接机制**：不使用 LangGraph，用纯 Python 实现一个基于 handoff 的 Swarm 模式。要求：定义 3 个 Agent（研究员、写作者、编辑），每个 Agent 有一个 `transfer_to_xxx` 工具，Agent 自主决定交接对象。对比 Swarm 模式和 Supervisor 模式在"撰写一份市场调研报告"任务上的流程差异。

3. **Hierarchical 模式实战**：构建一个两层 Hierarchical 系统。顶层 Supervisor 管理两个子团队：研发团队（产品经理+程序员+测试工程师）和运维团队（部署工程师+监控工程师）。顶层 Supervisor 根据任务类型分配给子团队，子团队内部自主流转。要求使用 LangGraph 的子图功能实现。

## 参考文献

1. Wu, Q. et al. "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." Microsoft Research, 2023. arXiv:2308.08155
2. Park, J.S. et al. "Generative Agents: Interactive Simulacra of Human Behavior." UIST 2023.
3. Du, Y. et al. "Improving Factuality and Reasoning in Language Models through Multiagent Debate." ICML 2024.

## 开放讨论

1. **多 Agent 系统的"涌现行为"是福还是祸？** 单个 Agent 的行为是可预测的，但多个 Agent 交互后可能产生意想不到的涌现行为——比如两个 Agent 无限循环传递任务，或者互相修改对方的输出导致不稳定。如何设计机制来检测和抑制有害的涌现行为，同时保留有益的涌现能力？

2. **Supervisor 模式中的单点故障问题。** Supervisor 是整个系统的"大脑"，如果它做出了错误的路由决策（比如把测试任务分配给了产品经理），整个流程就会跑偏。如何让 Supervisor 本身也受到"监督"？是否需要一个"Meta-Supervisor"来审查 Supervisor 的决策？

3. **多 Agent 系统与微服务架构的类比。** 多 Agent 系统的很多设计问题（通信机制、服务发现、容错、可观测性）与微服务架构高度相似。我们能否把微服务领域的成熟实践（如断路器、服务网格、分布式追踪）迁移到多 Agent 系统中？有哪些本质区别使得简单类比可能误导？

---
