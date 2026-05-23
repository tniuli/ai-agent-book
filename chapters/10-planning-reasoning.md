# 第10章 规划与推理

> 谋定而后动，知止而有得。——《大学》

当你面对一个复杂问题时，你是直接动手，还是先想清楚再干？如果你的回答是"先想清楚"，你已经掌握了本章的核心思想。规划与推理，正是 AI Agent 从"工具"进化为"智能体"的关键能力——一个只会机械执行的 Agent 不过是高级脚本，而一个能思考、能规划、能纠错的 Agent，才配得上"智能"二字。本章将深入探讨 Chain-of-Thought、Tree-of-Thought、Plan-and-Execute、Reflexion 四大推理范式，理解自我反思与纠错机制如何提升 Agent 的可靠性，学会在 LangGraph 中实现规划型 Agent，并实战构建一个自主规划的研究型 Agent。

---

## 10.1 Chain-of-Thought（CoT）与自一致性

### 10.1.1 为什么需要"思维链"？

想象一下，你在考试中遇到一道复杂的数学题。如果你直接写答案，大概率会出错。但如果你把每一步推导都写出来，正确率就会大幅提升。这个朴素的经验，恰恰是 Chain-of-Thought（CoT，思维链）的核心思想。

2022年，Jason Wei 等人在论文《Chain-of-Thought Prompting Elicits Reasoning in Large Language Models》中正式提出了这个概念。核心发现非常简洁：**在大语言模型（LLM）的提示词中加入"让我们一步一步思考"，就能显著提升模型在推理任务上的表现。**

这背后的逻辑是：LLM 本质上是一个自回归模型——它逐 token 生成输出。当你要求模型"直接给出答案"时，它实际上是在用一个 token 的输出空间去压缩多步推理的结果，信息瓶颈极大。而当你允许它"一步一步思考"时，每一步推理的中间结果都成为了后续推理的上下文，相当于把推理的"工作记忆"从零扩展到了整个序列长度。

古语云：**"三思而后行。"** CoT 的本质，就是让 LLM "三思"——不是直接跳到结论，而是把思考过程展开，让每一步都有据可依。

### 10.1.2 CoT 的两种形态

CoT 有两种主要的使用方式：

**零样本 CoT（Zero-shot CoT）**

最简单的形式，只需在提示词末尾加上一句魔法咒语：

```
请回答以下问题。
问题：一个商店有23个苹果，卖了15个，又进货了8个，现在有多少个苹果？
让我们一步一步思考。
```

**少样本 CoT（Few-shot CoT）**

在提示词中提供几个"推理示范"，让模型学习推理的格式和节奏：

```
问题：餐厅有5桌客人，每桌4人，走了3桌后还剩多少人？
回答：初始人数 = 5桌 × 4人/桌 = 20人。走了3桌，走了的人数 = 3 × 4 = 12人。剩余人数 = 20 - 12 = 8人。答案是8。

问题：一个商店有23个苹果，卖了15个，又进货了8个，现在有多少个苹果？
回答：
```

少样本 CoT 的效果通常优于零样本 CoT，因为它不仅告诉模型"要推理"，还示范了"怎么推理"。

### 10.1.3 自一致性：多条路通往真理

CoT 有一个隐含的问题：推理路径可能不稳定。同一个问题，模型可能走不同的推理路径，有些正确，有些错误。如何提高推理的可靠性？

Wang 等人提出了**自一致性（Self-Consistency）**策略，思路非常优雅：

1. 对同一个问题，用 CoT 生成多条推理路径（通过设置 temperature > 0）
2. 从多条路径中提取各自的答案
3. 选择出现频率最高的答案（多数投票）

这就像找路——如果10个人分别独立探路，8个人走到了同一个目的地，那这个目的地大概率是正确的。

```
自一致性流程：

  问题 ──┬── CoT采样1 → 推理路径1 → 答案A
         ├── CoT采样2 → 推理路径2 → 答案B
         ├── CoT采样3 → 推理路径3 → 答案A
         ├── CoT采样4 → 推理路径4 → 答案A
         └── CoT采样5 → 推理路径5 → 答案C
                                        │
                          多数投票 ──→ 答案A ✓
```

自一致性的关键参数是采样次数（通常5-40次）和温度（0.7-1.0）。采样越多，结果越稳定，但成本也越高。

### 10.1.4 CoT 的适用场景与局限

**适用场景：**
- 数学推理、逻辑判断
- 多步骤问题（需要中间计算）
- 常识推理（需要关联多个知识点）

**局限性：**
- 推理路径可能"走偏"——中间步骤出错会累积
- 不适合需要回溯或试错的问题（CoT 是线性的）
- 增加了 token 消耗，成本上升
- 对于简单问题反而可能引入噪声

---

## 10.2 Tree-of-Thought（ToT）

> ⚠️ 常见陷阱：DFS 陷入局部最优与 LLM 评分不一致。在使用 DFS 搜索思维树时，Agent 可能沿着一条看似有希望的路径越走越深，但实际上已经偏离了正确方向——这就是局部最优陷阱。更糟的是，LLM 作为状态评估器，其打分在不同调用之间可能不一致：同一个思维状态，上一次评估 8 分，下一次可能只给 5 分，导致搜索策略摇摆不定。解决方案：设置搜索深度上限和回溯阈值（连续 2 次评估下降则回溯），对 LLM 评分做多次采样取平均以提高稳定性，或使用 BFS 在浅层充分探索后再深入。

### 10.2.1 从"一条路"到"一棵树"

CoT 是线性的——它沿着一条路径从头走到尾。但现实中的复杂问题，往往需要探索、回溯、甚至"走回头路"。比如下象棋，你不会只想一步棋，而是会考虑多种走法，评估每种走法的后果，再选择最优的一步。

Tree-of-Thought（ToT，思维树）正是受此启发。Yao 等人在2023年的论文中提出：将推理过程组织成一棵树，每个节点是一个"思维状态"，每个分支是一种可能的推理方向，通过搜索算法（如 BFS 或 DFS）在树上探索，找到最优解。

```
CoT vs ToT 对比：

  CoT（线性推理）：              ToT（树状推理）：

  思维1 → 思维2 → 思维3        思维1 ──┬── 思维2a ──┬── 思维3a ✓
        → 答案                   │            └── 思维3b
                                 └── 思维2b ──── 思维3c
                                      │
                                   评估：2a更好
                                   剪枝：放弃2b分支
```

### 10.2.2 ToT 的四个核心组件

ToT 框架由四个关键组件构成：

**1. 思维分解（Thought Decomposition）**

将问题分解为中间的"思维步骤"。每一步不应该太细碎（搜索空间爆炸），也不应该太粗略（失去探索价值）。比如解24点游戏，一个合理的分解是"每一步选两个数做一次运算"。

**2. 思维生成器（Thought Generator）**

给定当前的思维状态，生成多个候选的下一步思维。两种方式：
- **采样法**：用同一个提示词多次采样（适合创意性强的场景）
- **提议法**：用一次提示让模型给出多个提议（适合步骤明确的场景）

**3. 状态评估器（State Evaluator）**

评估每个思维状态的"前景"——它有多可能通向正确答案？评估方式：
- **独立评估**：对每个状态独立打分
- **比较评估**：将多个状态放在一起比较排序

**4. 搜索算法（Search Algorithm）**

在思维树上进行搜索：
- **广度优先搜索（BFS）**：逐层展开，适合思维步骤较少但每步选择较多的场景
- **深度优先搜索（DFS）**：深入一条路径，失败则回溯，适合思维步骤多但每步选择少的场景

### 10.2.3 ToT 实战：24点游戏

24点游戏是 ToT 论文中的经典示例。给定4个数字，通过加减乘除运算使结果为24。

```
输入：1, 2, 3, 4
目标：用 +, -, ×, ÷ 使结果为24

思维树搜索过程：

第1步：选择两个数运算
├── 1+2=3, 剩余 [3, 3, 4]  → 评估：中等
├── 2×3=6, 剩余 [1, 6, 4]  → 评估：高 ★
├── 3×4=12, 剩余 [1, 2, 12] → 评估：高 ★
└── 1×4=4, 剩余 [2, 3, 4]  → 评估：中等

第2步（展开高评估分支）：
├── [1, 6, 4] → 6×4=24, 剩余 [1, 24] → 1×24=24 ✓
└── [1, 2, 12] → 12×2=24, 剩余 [1, 24] → 1×24=24 ✓

找到两条解法！
```

### 10.2.4 ToT 的适用场景与局限

**适用场景：**
- 需要试错和回溯的问题（如游戏策略、数学证明）
- 解空间较大，线性推理容易走入死胡同
- 需要全局最优而非局部最优

**局限性：**
- 搜索成本高——每一步都要生成和评估多个候选
- 对于简单问题过度设计，性价比低
- 评估器的质量直接影响搜索效率
- 需要仔细设计思维分解粒度

---

## 10.3 Plan-and-Execute

### 10.3.1 "谋定而后动"的工程实现

古语云：**"谋定而后动。"** 在行动之前先制定计划，这是人类数千年的智慧。Plan-and-Execute（规划与执行）模式正是这一智慧的工程实现。

核心思想非常简单：**将"想"和"做"分离**。先用 LLM 生成一个计划（Plan），再逐步执行计划中的每个步骤（Execute），执行过程中还可以根据反馈调整计划（Replan）。

```
Plan-and-Execute 流程：

  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  用户任务 │────→│  规划器   │────→│  执行器   │
  └──────────┘     │(Planner) │     │(Executor)│
                   └──────────┘     └────┬─────┘
                        ↑                 │
                        │    ┌────────────┘
                        │    ↓
                   ┌──────────┐
                   │  重规划器  │
                   │(Replanner)│
                   └──────────┘
                        ↑
                        │
                   ┌──────────┐
                   │  执行反馈  │
                   └──────────┘
```

### 10.3.2 三个核心组件

**1. 规划器（Planner）**

规划器接收用户任务，将其分解为有序的子步骤列表。好的规划应该：
- **可执行**：每个步骤都能被明确执行
- **有顺序**：步骤之间有逻辑依赖关系
- **可验证**：每个步骤的完成标准清晰

规划器的提示词模板：

```python
PLAN_PROMPT = """你是一个任务规划专家。请将用户的任务分解为清晰的步骤。

用户任务：{task}

已知已完成的步骤：{past_steps}

请输出接下来的步骤列表（JSON格式）：
[
  {{"step": "步骤描述", "description": "详细说明"}},
  ...
]

如果没有更多步骤需要执行，请返回空列表 []。
"""
```

**2. 执行器（Executor）**

执行器负责执行计划中的每一个步骤。它可以是：
- 一个 LLM 调用（生成文本、回答问题）
- 一个工具调用（搜索、计算、代码执行）
- 一个子 Agent 调用

执行器的关键是将"步骤描述"转化为具体的行动，并返回执行结果。

**3. 重规划器（Replanner）**

重规划器根据执行反馈调整计划。这不是"推倒重来"，而是"动态调整"。可能的情况：
- 某个步骤失败了——需要换一种方式执行
- 获得了新信息——需要调整后续步骤
- 发现原计划遗漏了重要步骤——需要补充

重规划器的提示词模板：

```python
REPLAN_PROMPT = """你是一个任务规划专家，需要根据执行反馈调整计划。

原始任务：{task}
原计划：{plan}
已完成的步骤和结果：{past_steps}

请根据执行反馈，输出更新后的剩余步骤：
[
  {{"step": "步骤描述", "description": "详细说明"}},
  ...
]

如果任务已完成，请返回空列表 []。
"""
```

### 10.3.3 Plan-and-Execute 的关键设计决策

| 设计决策 | 选项A | 选项B | 建议 |
|---------|-------|-------|------|
| 规划粒度 | 细粒度（每步很小） | 粗粒度（每步较大） | 粗粒度优先，执行时按需细化 |
| 重规划时机 | 每步执行后 | 仅失败时 | 每步执行后，保持灵活性 |
| 规划器模型 | 强模型（如 GPT-4） | 轻量模型 | 规划用强模型，执行用轻量模型 |
| 并行执行 | 顺序执行 | 并行执行 | 独立步骤可并行，有依赖则顺序 |

### 10.3.4 适用场景与局限

**适用场景：**
- 多步骤复杂任务（如研究报告、旅行规划）
- 需要调用多种工具的编排任务
- 任务结构相对明确，可预分解

**局限性：**
- 规划质量取决于 LLM 的理解能力
- 缺乏执行中的"深度思考"——每步执行是浅层的
- 重规划可能陷入"规划循环"——不断调整却无法推进
- 对于需要实时探索的任务，预规划的灵活性不足

---

## 10.4 自我反思与纠错

### 10.4.1 "过而能改，善莫大焉"

古语云：**"过而能改，善莫大焉。"** 犯错不可怕，可怕的是不知道自己错了，或者知道错了却不改。

Reflexion 模式正是这一智慧在 AI Agent 中的体现。Shinn 等人在2023年的论文中提出：让 Agent 在执行任务后进行自我反思，将反思结果作为"语言反馈"存入记忆，在下次尝试时参考，从而逐步改进。

```
Reflexion 流程：

  ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐
  │ 任务  │───→│ 执行  │───→│ 评估  │───→│ 反思  │
  └──────┘    └──────┘    └──────┘    └──┬───┘
               ↑                         │
               │    ┌──────────┐         │
               └────│ 记忆存储  │←────────┘
                    │(反思记录) │
                    └──────────┘

  第1轮：执行 → 失败 → 反思："我忽略了条件X"
  第2轮：带着反思执行 → 仍有问题 → 反思："还需要考虑Y"
  第3轮：带着两次反思执行 → 成功！
```

### 10.4.2 Reflexion 的三个关键机制

**1. 自我评估（Self-Evaluation）**

Agent 完成任务后，需要判断结果是否正确。评估方式有两种：
- **启发式评估**：用规则判断（如代码能否通过测试、答案是否匹配）
- **LLM 评估**：让 LLM 自己判断输出质量

启发式评估更可靠，但需要领域知识；LLM 评估更通用，但可能"自我感觉良好"。

**2. 自我反思（Self-Reflection）**

当评估不通过时，Agent 需要分析"哪里出了问题，为什么会出错"。反思的提示词模板：

```python
REFLECTION_PROMPT = """你刚刚完成了一个任务，但结果不理想。请反思你的执行过程。

任务：{task}
你的执行过程：{trajectory}
评估结果：{evaluation}

请分析：
1. 你在哪里犯了错误？
2. 为什么会犯这个错误？
3. 下次应该如何避免？

请用简洁的语言输出你的反思：
"""
```

**3. 记忆机制（Memory）**

反思结果被存入一个持久的记忆结构。在下一轮尝试时，Agent 可以访问之前的反思记录，避免重蹈覆辙。这种记忆是**语言形式**的——不是向量，不是参数，而是一段自然语言描述。这使得反思记忆具有极强的可解释性。

### 10.4.3 Reflexion 与其他纠错机制的对比

| 机制 | 原理 | 优势 | 劣势 |
|------|------|------|------|
| 简单重试 | 不加反思，直接重新执行 | 简单 | 容易重复犯错 |
| 外部反馈 | 由人类或规则给出纠错建议 | 可靠 | 依赖外部信号 |
| Reflexion | Agent 自我反思并记忆 | 自主、可扩展 | 反思可能不准确 |
| ReAct+Reflexion | 行动+观察+反思三位一体 | 全面 | 成本较高 |

### 10.4.4 适用场景与局限

**适用场景：**
- 代码生成（测试反馈驱动反思）
- 决策任务（尝试-反思-改进循环）
- 多轮对话（根据用户反馈自我修正）

**局限性：**
- 反思质量取决于 LLM 的"元认知"能力——弱模型可能无法准确诊断错误
- 缺乏外部信号时，反思可能陷入"自我确认偏误"
- 多轮反思的 token 消耗较高
- 对于需要精确计算的任务，反思无法弥补模型能力的不足

---

## 10.5 LangGraph 中的规划实现

### 10.5.1 为什么用 LangGraph？

前几节我们讨论了推理策略的理论，现在需要将它们落地。LangGraph 是目前实现规划推理 Agent 最成熟的框架之一，原因有三：

1. **图结构天然适合规划**——Plan、Execute、Replan 各为图中的节点，边定义流转逻辑
2. **状态管理清晰**——LangGraph 的 State 机制天然存储计划、执行结果和反思记录
3. **可控的循环**——条件边让 Agent 在"继续执行"和"重新规划"之间灵活切换

### 10.5.2 状态设计

规划推理 Agent 的状态需要包含以下信息：

```python
# version
from typing import Annotated, TypedDict
import operator

class PlanExecuteState(TypedDict):
    input: str                      # 用户原始任务
    plan: list[str]                 # 当前计划（步骤列表）
    past_steps: Annotated[list[tuple[str, str]], operator.add]  # 已完成的步骤及结果
    response: str                   # 最终响应
```

这里有两个设计要点：
- `past_steps` 使用 `Annotated[list, operator.add]`，意味着每次追加而非覆盖，保留完整的执行历史
- `plan` 是 `list[str]` 而非 `list[dict]`，保持简洁——每个步骤就是一个字符串描述

### 10.5.3 节点实现

**Plan Node（规划节点）**

```python
# version
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

plan_prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个任务规划专家。请将用户任务分解为清晰的步骤。
    每个步骤应该简洁、可执行、可验证。
    只输出步骤列表，不要其他内容。"""),
    ("user", "任务：{task}\n\n请输出步骤列表："),
])

plan_chain = plan_prompt | ChatOpenAI(model="gpt-4o-mini")

def plan_step(state: PlanExecuteState) -> dict:
    plan = plan_chain.invoke({"task": state["input"]})
    # 将输出解析为步骤列表
    steps = [line.strip() for line in plan.content.split("\n")
             if line.strip() and not line.strip().startswith("#")]
    return {"plan": steps}
```

**Execute Node（执行节点）**

```python
# version
from langchain_core.prompts import ChatPromptTemplate

execute_prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个任务执行者。请执行给定的步骤，并返回执行结果。"),
    ("user", "当前步骤：{step}\n上下文：{context}"),
])

execute_chain = execute_prompt | ChatOpenAI(model="gpt-4o-mini")

def execute_step(state: PlanExecuteState) -> dict:
    plan = state["plan"]
    if not plan:
        return {"response": "计划为空，无步骤可执行。"}
    step = plan[0]
    context = f"原始任务：{state['input']}\n已完成：{state.get('past_steps', [])}"
    result = execute_chain.invoke({"step": step, "context": context})
    return {"past_steps": [(step, result.content)]}
```

**Replan Node（重规划节点）**

```python
# version
replan_prompt = ChatPromptTemplate.from_messages([
    ("system", """你是一个任务规划专家。根据执行反馈调整计划。
    已完成的步骤不需要再执行。如果任务已完成，返回空列表。"""),
    ("user", """原始任务：{task}
    已完成的步骤及结果：{past_steps}
    原计划剩余步骤：{remaining_plan}

    请输出更新后的剩余步骤列表（如果任务已完成，输出空列表）："""),
])

replan_chain = replan_prompt | ChatOpenAI(model="gpt-4o-mini")

def replan_step(state: PlanExecuteState) -> dict:
    completed = [s for s, _ in state.get("past_steps", [])]
    remaining = [s for s in state["plan"] if s not in completed]
    output = replan_chain.invoke({
        "task": state["input"],
        "past_steps": state.get("past_steps", []),
        "remaining_plan": remaining,
    })
    new_steps = [line.strip() for line in output.content.split("\n")
                 if line.strip() and not line.strip().startswith("#")]
    if not new_steps:
        # 任务完成，汇总结果
        results = "\n".join(
            f"- {step}: {result}"
            for step, result in state.get("past_steps", [])
        )
        return {"response": f"任务完成！执行摘要：\n{results}", "plan": []}
    return {"plan": new_steps}
```

### 10.5.4 图的构建与路由

```python
# version
from langgraph.graph import StateGraph, END

def should_end(state: PlanExecuteState) -> str:
    """决定下一步是继续执行还是结束"""
    if state.get("response"):
        return "end"
    if not state.get("plan"):
        return "end"
    return "continue"

# 构建图
workflow = StateGraph(PlanExecuteState)

# 添加节点
workflow.add_node("planner", plan_step)
workflow.add_node("executor", execute_step)
workflow.add_node("replanner", replan_step)

# 设置入口
workflow.set_entry_point("planner")

# 添加边
workflow.add_edge("planner", "executor")
workflow.add_edge("executor", "replanner")

# 条件边
workflow.add_conditional_edges(
    "replanner",
    should_end,
    {"continue": "executor", "end": END},
)

# 编译
app = workflow.compile()
```

LangGraph 的 Plan-Execute 图结构如下：

```
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ Planner  │────→│ Executor │────→│Replanner │
  └──────────┘     └──────────┘     └────┬─────┘
                                        │
                            ┌───────────┼───────────┐
                            │                       │
                      continue                   end
                            │                       │
                            ↓                       ↓
                      ┌──────────┐           ┌──────────┐
                      │ Executor │           │   END    │
                      └──────────┘           └──────────┘
```

---

## 10.6 实战

### 10.6.1 需求分析

我们要构建一个研究型 Agent，它能够：
1. 接收一个研究主题
2. 自主规划研究步骤（搜索、整理、分析、总结）
3. 逐步执行每个步骤
4. 执行后自我反思，发现不足则调整计划
5. 最终输出一份结构化的研究报告

这个 Agent 融合了 Plan-and-Execute 和 Reflexion 两种模式：用 Plan-and-Execute 组织整体流程，用 Reflexion 在关键节点进行自我反思。

### 10.6.2 架构设计

```
研究型 Agent 架构：

  ┌──────────────────────────────────────────────────────────┐
  │                   Research Agent                         │
  │                                                          │
  │  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐    │
  │  │ Plan   │──→│Execute │──→│Reflect │──→│Replan  │    │
  │  │ Node   │   │ Node   │   │ Node   │   │ Node   │    │
  │  └────────┘   └───┬────┘   └────────┘   └───┬────┘    │
  │                   │                         │          │
  │              ┌────┴────┐              ┌─────┴─────┐    │
  │              │ Tools   │              │ 记忆存储   │    │
  │              │ Search  │              │ 反思记录   │    │
  │              │ Analyze │              │ 执行历史   │    │
  │              │ Write   │              └───────────┘    │
  │              └─────────┘                               │
  └──────────────────────────────────────────────────────────┘
```

### 10.6.3 完整代码实现

下面是完整可运行的代码。请确保已安装 `requirements.txt` 中的依赖。

```python
# version
"""
研究型 Agent —— 基于 LangGraph 的 Plan-Execute + Reflexion 实现
支持自主规划、工具调用、自我反思与重规划
"""

import os
import json
from typing import Annotated, TypedDict
import operator

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_community.tools.tavily_search import TavilySearchResults
from langgraph.graph import StateGraph, END


# ============================================================
# 1. 状态定义
# ============================================================

class ResearchState(TypedDict):
    """研究型 Agent 的状态"""
    input: str                                              # 研究主题
    plan: list[str]                                         # 当前计划
    past_steps: Annotated[list[tuple[str, str]], operator.add]  # 已完成步骤及结果
    reflections: Annotated[list[str], operator.add]          # 反思记录
    response: str                                           # 最终报告


# ============================================================
# 2. 工具定义
# ============================================================

# 搜索工具（需要 TAVILY_API_KEY 环境变量）
search_tool = TavilySearchResults(max_results=3)

tools = [search_tool]

# LLM 绑定工具
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
llm_with_tools = llm.bind_tools(tools)


# ============================================================
# 3. 节点实现
# ============================================================

def plan_node(state: ResearchState) -> dict:
    """规划节点：生成研究计划"""
    plan_prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个研究规划专家。请为给定主题制定研究计划。

要求：
1. 计划应包含3-6个步骤
2. 每步应明确说明要做什么（搜索、分析、总结等）
3. 步骤之间有逻辑顺序
4. 最后一步必须是"撰写研究报告"

{reflections_context}

只输出步骤列表，每行一个步骤，不要编号或其他格式。"""),
        ("user", "研究主题：{task}"),
    ])

    reflections_context = ""
    if state.get("reflections"):
        reflections_context = "之前的反思：\n" + "\n".join(
            f"- {r}" for r in state["reflections"]
        )

    chain = plan_prompt | llm
    result = chain.invoke({
        "task": state["input"],
        "reflections_context": reflections_context,
    })

    steps = [line.strip().lstrip("0123456789.-) ") for line in result.content.split("\n")
             if line.strip()]
    return {"plan": steps}


def execute_node(state: ResearchState) -> dict:
    """执行节点：执行当前步骤"""
    if not state.get("plan"):
        return {"past_steps": [("", "没有可执行的步骤")]}

    current_step = state["plan"][0]

    # 构建执行上下文
    past_summary = ""
    for step, result in state.get("past_steps", []):
        past_summary += f"步骤「{step}」的结果：{result[:200]}...\n"

    reflections_summary = ""
    for r in state.get("reflections", []):
        reflections_summary += f"- {r}\n"

    execute_prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个研究执行者。请执行当前步骤。

已完成的工作：
{past_summary}

反思记录：
{reflections_summary}

如果需要搜索信息，请使用搜索工具。如果步骤不需要搜索，直接给出你的分析或总结。"""),
        ("user", "当前步骤：{step}"),
    ])

    chain = execute_prompt | llm_with_tools
    result = chain.invoke({
        "step": current_step,
        "past_summary": past_summary,
        "reflections_summary": reflections_summary,
    })

    # 提取结果文本
    content = result.content if result.content else "执行完成"
    return {"past_steps": [(current_step, content)]}


def reflect_node(state: ResearchState) -> dict:
    """反思节点：评估执行结果，发现不足"""
    if not state.get("past_steps"):
        return {"reflections": []}

    last_step, last_result = state["past_steps"][-1]

    reflect_prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个研究质量审核员。请评估最新步骤的执行质量。

研究主题：{task}
当前步骤：{step}
执行结果：{result}

已完成的所有步骤：{all_steps}

请思考：
1. 这个步骤的结果是否充分？是否有遗漏？
2. 是否需要补充搜索或分析？
3. 后续步骤是否需要调整？

如果一切良好，输出"无需调整"。
如果需要改进，请简要说明需要改进什么。"""),
        ("user", "请评估："),
    ])

    chain = reflect_prompt | llm
    result = chain.invoke({
        "task": state["input"],
        "step": last_step,
        "result": last_result,
        "all_steps": str(state.get("past_steps", [])),
    })

    reflection = result.content.strip()
    if reflection == "无需调整":
        return {"reflections": []}
    return {"reflections": [reflection]}


def replan_node(state: ResearchState) -> dict:
    """重规划节点：根据反思调整计划"""
    replan_prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个研究规划专家。根据执行情况和反思，调整剩余计划。

研究主题：{task}
已完成的步骤及结果：{past_steps}
反思记录：{reflections}
原计划剩余步骤：{remaining_plan}

如果任务已经完成（有足够的信息撰写报告），返回空列表。
否则，输出更新后的剩余步骤，每行一个。"""),
        ("user", "请调整计划："),
    ])

    completed_steps = [s for s, _ in state.get("past_steps", [])]
    remaining = [s for s in state.get("plan", [])
                 if s not in completed_steps]

    chain = replan_prompt | llm
    result = chain.invoke({
        "task": state["input"],
        "past_steps": str(state.get("past_steps", [])),
        "reflections": "\n".join(state.get("reflections", [])),
        "remaining_plan": "\n".join(remaining),
    })

    new_steps = [line.strip().lstrip("0123456789.-) ") for line in result.content.split("\n")
                 if line.strip()]

    if not new_steps or "任务完成" in result.content:
        # 生成最终报告
        report = generate_report(state)
        return {"response": report, "plan": []}

    return {"plan": new_steps}


def generate_report(state: ResearchState) -> str:
    """生成最终研究报告"""
    report_prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个研究报告撰写专家。请根据以下研究过程和结果，撰写一份结构化的研究报告。

报告格式：
## 研究主题
{topic}

## 研究过程
（概述执行了哪些步骤）

## 核心发现
（整理所有步骤的关键发现）

## 详细分析
（按主题组织深入分析）

## 总结与展望
（总结研究结论，指出可能的延伸方向）

请确保报告内容充实、逻辑清晰、有深度。"""),
        ("user", "研究过程：\n{process}"),
    ])

    process = ""
    for step, result in state.get("past_steps", []):
        process += f"### {step}\n{result}\n\n"

    chain = report_prompt | llm
    result = chain.invoke({
        "topic": state["input"],
        "process": process,
    })

    return result.content


# ============================================================
# 4. 路由逻辑
# ============================================================

def should_continue(state: ResearchState) -> str:
    """决定是否继续执行"""
    if state.get("response"):
        return "end"
    if not state.get("plan"):
        return "end"
    # 检查是否所有步骤都执行完毕（防止无限循环）
    if len(state.get("past_steps", [])) >= 8:
        report = generate_report(state)
        return "end"
    return "continue"


# ============================================================
# 5. 图的构建
# ============================================================

def build_research_agent():
    """构建研究型 Agent"""
    workflow = StateGraph(ResearchState)

    # 添加节点
    workflow.add_node("planner", plan_node)
    workflow.add_node("executor", execute_node)
    workflow.add_node("reflector", reflect_node)
    workflow.add_node("replanner", replan_node)

    # 设置入口
    workflow.set_entry_point("planner")

    # 添加边
    workflow.add_edge("planner", "executor")
    workflow.add_edge("executor", "reflector")
    workflow.add_edge("reflector", "replanner")

    # 条件边
    workflow.add_conditional_edges(
        "replanner",
        should_continue,
        {"continue": "executor", "end": END},
    )

    return workflow.compile()


# ============================================================
# 6. 运行
# ============================================================

if __name__ == "__main__":
    # 确保设置了环境变量
    if not os.environ.get("OPENAI_API_KEY"):
        print("请设置 OPENAI_API_KEY 环境变量")
        exit(1)
    if not os.environ.get("TAVILY_API_KEY"):
        print("请设置 TAVILY_API_KEY 环境变量（可在 https://tavily.com 免费获取）")
        exit(1)

    agent = build_research_agent()

    # 执行研究任务
    topic = "大语言模型在软件开发中的应用现状与趋势"
    print(f"开始研究：{topic}\n")

    result = agent.invoke({"input": topic})

    print("\n" + "=" * 60)
    print("研究报告")
    print("=" * 60)
    print(result.get("response", "未能生成报告"))
```

### 10.6.4 运行说明

1. 安装依赖：`pip install -r requirements.txt`
2. 设置环境变量：
   ```bash
   export OPENAI_API_KEY="your-key"
   export TAVILY_API_KEY="your-key"  # 在 https://tavily.com 免费获取
   ```
3. 运行：`python research_agent.py`

### 10.6.5 关键设计解读

**为什么在 Reflector 之后才 Replan？**

很多实现把 Replan 放在 Execute 之后直接触发。我们增加了一个 Reflector 节点，让 Agent 在重新规划之前先"想一想"：刚才的执行效果如何？问题出在哪里？这种"反思→调整"的循环比"执行→调整"更智能，因为它不是盲目地换一种方式重试，而是有针对性地改进。

**为什么限制最大步数为8？**

Agent 可能陷入"无限规划"的死循环——不断生成新计划，却永远无法完成。设置最大步数是一种简单而有效的兜底机制。在生产环境中，你还应该加入 token 预算控制、超时机制等。

**为什么用 gpt-4o-mini 而不是 gpt-4o？**

研究型 Agent 的每次运行可能涉及10+次 LLM 调用（规划1次+执行N次+反思N次+重规划N次+报告1次）。用 gpt-4o 成本过高，gpt-4o-mini 在推理任务上已经有不错的表现。如果需要更高质量的输出，可以对规划节点和报告生成节点使用更强的模型，执行节点仍用轻量模型——这正是 Plan-and-Execute 的优势：不同步骤可以用不同模型。

---

## 10.7 推理模型的崛起

### 10.7.1 推理模型：内置思维链的新范式

2024 年底，OpenAI 发布了 o1 模型，随后 o3 系列相继问世。这类推理模型（Reasoning Model）的核心特征是：**模型在输出最终答案之前，会自动进行一段"内部思维链"推理。** 这段推理对用户不可见（或可选择展示），但模型确实在"思考"——分解问题、验证中间步骤、回溯错误路径。

这与传统 CoT 的根本区别在于：传统 CoT 是**显式的提示词技巧**——你需要在提示词中写"让我们一步一步思考"，模型才会展开推理过程；而推理模型的 CoT 是**隐式的内置能力**——即使你只问一个简单问题，模型也会自动判断是否需要深度推理，并在内部完成。

```
传统 CoT（显式）：

  用户提示词 + "让我们一步一步思考"
       │
       ▼
  模型输出：思考步骤1 → 思考步骤2 → ... → 最终答案
  （每一步都占用输出 token，用户可见）

推理模型的 CoT（隐式）：

  用户提示词（无需额外指令）
       │
       ▼
  <内部推理>：分析问题 → 尝试路径1 → 发现矛盾 → 尝试路径2 → 验证 → 确认
       │
       ▼
  最终答案
  （推理过程不占用输出 token，部分可选择性展示）
```

推理模型的 CoT 还具有传统 CoT 不具备的能力——它可以在推理过程中**回溯和纠错**。如果某条推理路径走进了死胡同，模型可以放弃并换一条路径，而不是像传统 CoT 那样只能沿着线性路径一直走下去。

### 10.7.2 什么时候显式 CoT 仍然有价值？

推理模型虽然内置了思维链，但显式的 CoT 提示词在以下场景中仍然不可替代：

**成本优化**：推理模型的内部推理会消耗大量 token（o1 的一次推理可能消耗数千 token），对于简单问题，用普通模型 + CoT 提示词可以在 1/10 的成本下达到相近效果。不是每个问题都需要"核弹打蚊子"。

**控制与透明**：显式 CoT 让推理过程完全可观测——你可以看到每一步推理，发现中间错误，调整提示词策略。推理模型的内部推理是黑箱，你只能看到最终答案，无法精确控制推理路径。

**结构化推理**：当你需要模型按照特定的推理框架（如"先列出假设，再逐一验证"或"先分析问题类型，再选择策略"）进行推理时，显式 CoT 提示词可以强制模型遵循这个框架。推理模型可能选择自己的推理路径，不一定符合你期望的结构。

**团队协作**：在多 Agent 系统中，一个 Agent 的推理过程可能需要被其他 Agent 理解和引用。显式 CoT 天然适合这种场景——推理过程就是输出的一部分，其他 Agent 可以直接读取。

### 10.7.3 什么时候推理模型让 CoT 冗余？

**高难度推理任务**：数学竞赛题、复杂逻辑推理、多步骤证明——这些任务需要真正的"深度思考"，推理模型的内部 CoT 比显式 CoT 更强大，因为它可以回溯、纠错、尝试多条路径。

**速度优先且预算充足**：如果对延迟和成本不敏感，推理模型可以直接处理大多数需要推理的任务，无需手动设计 CoT 提示词。

**非结构化问题**：当问题本身没有明确的推理框架可以遵循时，推理模型自主探索比人类预设的 CoT 结构更灵活。

### 10.7.4 决策框架：任务复杂度 vs 模型能力

```
┌──────────────────────────────────────────────────────────────┐
│                  CoT 策略决策矩阵                              │
├──────────────┬───────────────────┬───────────────────────────┤
│              │  普通模型 + CoT    │  推理模型（o1/o3）         │
├──────────────┼───────────────────┼───────────────────────────┤
│ 简单任务      │ ✓ 首选：低成本     │ △ 可用但浪费              │
│ （1-2步推理） │   快速可控         │   成本高，杀鸡用牛刀       │
├──────────────┼───────────────────┼───────────────────────────┤
│ 中等任务      │ ✓ 可用：需要精心   │ ✓ 可用：自动推理           │
│ （3-5步推理） │   设计 CoT 模板   │   无需额外提示词           │
├──────────────┼───────────────────┼───────────────────────────┤
│ 复杂任务      │ △ 勉强：容易出错   │ ✓ 首选：内置回溯           │
│ （5+步推理）  │   缺乏纠错能力     │   自动纠错更可靠           │
│              │   线性推理有瓶颈   │                           │
├──────────────┼───────────────────┼───────────────────────────┤
│ 结构化推理    │ ✓ 首选：可控框架   │ △ 可用但不可控             │
│ （需特定格式）│   透明可审计       │   内部推理黑箱             │
└──────────────┴───────────────────┴───────────────────────────┘
```

### 10.7.5 混合策略：各取所长

在实践中，最优方案不是"二选一"，而是**混合使用**：

1. **简单问题**：用普通模型 + 零样本 CoT，成本最低，效果足够
2. **结构化问题**（如报告撰写、方案评审）：用普通模型 + 精心设计的 CoT 模板，确保推理过程符合业务逻辑
3. **高难度推理**（如数学证明、逻辑推理、Bug 定位）：用推理模型，让它自主深度思考
4. **关键决策**：先用推理模型得出结论，再用普通模型 + CoT 对推理过程进行可解释性审查

这种"模型路由"思路，本质上就是把推理策略的选择权从"一刀切"变成"按需分配"——不同复杂度的任务使用不同的推理资源配置，在效果、成本和可控性之间取得最优平衡。

> 古语点睛："因材施教"——推理策略的选择也应因"题"制宜。推理模型如大将，可攻坚克难；普通模型 + CoT 如良吏，可按部就班。善用者不拘一法，因势而变。

---

## 📌 Prompt Engineering 融入：推理策略中的提示词设计

推理策略的成败，很大程度上取决于提示词（Prompt）的设计。本节我们总结各策略的提示词模板与设计要点。

### CoT 提示模板

```
【零样本 CoT】
请回答以下问题。
{question}
让我们一步一步思考。

【少样本 CoT】
以下是几个推理示例：
{examples}

现在请回答：
{question}
让我们一步一步思考。

【自一致性 CoT】
对同一问题采样N次，每次都使用 CoT 提示：
{question}
让我们一步一步思考。（temperature=0.7, n=5）
然后对N个答案进行多数投票。
```

**设计要点：**
- "让我们一步一步思考"是零样本 CoT 的触发短语，必须出现在提示末尾
- 少样本示例应覆盖不同推理模式（正向推导、逆向推理、排除法等）
- 自一致性的采样温度不宜过低（0.7-1.0），否则缺乏多样性

### ToT 提示模板

```
【思维生成】
当前状态：{current_state}
请生成{k}个可能的下一步思维：
1.
2.
3.

【状态评估】
当前思维状态：{state}
请评估该状态通向正确答案的可能性（0-10分）：
分数：

【搜索决策】
当前所有分支及其评估：
{branches_with_scores}
请选择最值得探索的分支：
```

**设计要点：**
- 思维生成时指定候选数量（如"请生成3个"），避免模型只给出一个
- 状态评估用数值评分比文字描述更方便比较
- 搜索决策提示应包含所有分支信息，让模型做全局判断

### Plan-and-Execute 提示模板

```
【规划】
你是一个任务规划专家。请将任务分解为步骤。
任务：{task}
输出格式：每行一个步骤，格式为"步骤：描述"

【执行】
你是一个任务执行者。请执行当前步骤。
当前步骤：{step}
上下文：{context}
可用工具：{tools}

【重规划】
根据执行反馈调整计划。
原始任务：{task}
已完成：{past_steps}
反馈：{feedback}
请输出剩余步骤（空列表表示完成）：
```

**设计要点：**
- 规划提示要明确输出格式，否则解析困难
- 执行提示要传入上下文（已完成步骤），避免重复劳动
- 重规划提示要包含"空列表表示完成"的约定，防止永远不停

### Reflexion 提示模板

```
【反思】
你刚刚完成了一个任务，但结果不理想。
任务：{task}
执行过程：{trajectory}
评估结果：{evaluation}

请分析：
1. 你在哪里犯了错误？
2. 为什么会犯这个错误？
3. 下次应该如何避免？

【带反思的执行】
你之前尝试过这个任务，以下是反思记录：
{reflections}
请参考反思，再次尝试：
{task}
```

**设计要点：**
- 反思提示要包含完整的执行轨迹，而非仅最终结果
- "三个问题"模板（哪里错、为什么、怎么避免）比开放反思更结构化
- 执行时引用反思记录，将反思转化为行动指导

---

## 四种推理策略流程对比图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    四种推理策略流程对比                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  CoT（线性推理）：                                                    │
│  ┌───┐   ┌───┐   ┌───┐   ┌───┐                                    │
│  │ Q │──→│S1 │──→│S2 │──→│ A │  单路径，不回溯                       │
│  └───┘   └───┘   └───┘   └───┘                                    │
│                                                                     │
│  自一致性（多路径投票）：                                               │
│       ┌──→ S1 → S2 → A1 ─┐                                        │
│  Q ───┼──→ S3 → S4 → A2 ─┼──→ 多数投票 → A1 ✓                      │
│       └──→ S5 → S6 → A1 ─┘  多路径，事后投票                        │
│                                                                     │
│  ToT（树状搜索）：                                                    │
│       ┌── S1a ──┬── S2a → A ✓                                       │
│  Q ───┤         └── S2b                                             │
│       ├── S1b ──── S2c      剪枝+回溯，找最优                        │
│       └── S1c ──── (剪枝)                                           │
│                                                                     │
│  Plan-and-Execute：                                                  │
│  ┌─────┐   ┌─────┐   ┌───────┐   ┌─────┐                          │
│  │Plan │──→│Exec1│──→│Replan │──→│Exec2│──→ ... ──→ Result         │
│  └─────┘   └─────┘   └───────┘   └─────┘  先规划，后执行，可调整     │
│                                                                     │
│  Reflexion：                                                         │
│  ┌──────┐   ┌──────┐   ┌───────┐   ┌──────┐                       │
│  │Exec1 │──→│Eval  │──→│Reflect│──→│Exec2 │──→ ... ──→ Success     │
│  └──────┘   └──┬───┘   └───────┘   └──────┘  执行+评估+反思循环     │
│                │失败                                                │
│                └→ 触发反思                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四种推理策略适用场景对比

```
┌───────────────┬────────────────────┬────────────────────┬───────────────┐
│    策略        │    最佳场景         │    不适合场景       │   成本等级     │
├───────────────┼────────────────────┼────────────────────┼───────────────┤
│ CoT           │ 数学推理、逻辑判断   │ 需要回溯的问题      │    低          │
│               │ 多步骤线性问题       │ 创意发散型任务      │   1x token     │
├───────────────┼────────────────────┼────────────────────┼───────────────┤
│ 自一致性       │ 答案空间有限的问题   │ 开放式生成任务      │    中          │
│               │ 需要高可靠性         │ 创意类任务          │   5-40x token  │
├───────────────┼────────────────────┼────────────────────┼───────────────┤
│ ToT           │ 博弈、搜索、规划     │ 简单问题            │    高          │
│               │ 需要全局最优         │ 步骤不明确的任务    │   10-100x      │
├───────────────┼────────────────────┼────────────────────┼───────────────┤
│ Plan-Execute  │ 多步骤复杂任务       │ 单步即可解决的问题  │    中          │
│               │ 工具编排             │ 需要深度推理的步骤  │   3-10x        │
├───────────────┼────────────────────┼────────────────────┼───────────────┤
│ Reflexion     │ 迭代改进型任务       │ 无评估标准的任务    │    中-高       │
│               │ 代码生成、写作       │ 单次即可正确的任务  │   3-10x/轮     │
└───────────────┴────────────────────┴────────────────────┴───────────────┘

选型口诀：
  线性推理用 CoT，求稳投票自一致。
  搜索回溯找 ToT，规划执行分步走。
  屡错屡改 Reflexion，策略组合更无敌。
```

---

## 进阶拓展：策略组合与混合架构

在实际项目中，单一推理策略往往不够用，组合使用才是王道。几种常见的组合模式：

**1. Plan-Execute + CoT**

在 Execute 节点内部使用 CoT，让每一步执行都有深度推理。这就像项目经理（Planner）制定了计划，而每个执行者（Executor）在执行时都会认真思考。

**2. Plan-Execute + Reflexion**

在每次执行后增加反思环节，根据反思调整计划。这正是我们10.6节实战中的做法。

**3. ToT + Reflexion**

在思维树的每个节点上加入反思——如果某条路径反复失败，反思会给出"放弃这条路径"的建议，加速剪枝。

**4. CoT + 自一致性 + Reflexion**

用 CoT 生成初始推理，用自一致性投票选出最佳答案，如果不满意则用 Reflexion 反思后重试。这是"三保险"策略，成本最高但可靠性也最强。

选择组合的关键原则：**根据任务的"不确定性来源"选择策略。** 如果不确定性来自推理路径（可能走错路），用 ToT；如果来自执行质量（可能做不好），用 Reflexion；如果来自答案可靠性（不确定对不对），用自一致性。

---

## 习题

1. **实现自一致性 CoT**：编写一个程序，对同一数学问题采样5次 CoT 推理，通过多数投票选出最终答案。对比单次 CoT 和自一致性的正确率差异。（提示：设置 temperature=0.7，使用不同的随机种子）

2. **ToT 求解24点游戏**：实现一个基于 ToT 的24点求解器。要求：思维分解为"选两个数做一次运算"，状态评估用 LLM 打分，搜索使用 DFS+回溯。测试用例：`[1, 5, 5, 5]`、`[3, 3, 8, 8]`、`[1, 4, 5, 6]`。

3. **Reflexion 代码生成**：构建一个 Reflexion 驱动的代码生成 Agent。给定一个编程题目，Agent 生成代码→运行测试→反思失败原因→重新生成。要求至少支持3轮反思，每轮反思结果存入记忆。使用 Python 的 `exec()` 或 `subprocess` 运行代码并获取错误信息。

## 参考文献

1. Wei, J. et al. "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." NeurIPS 2022.
2. Yao, S. et al. "Tree of Thoughts: Deliberate Problem Solving with Large Language Models." NeurIPS 2023.
3. Shinn, N. et al. "Reflexion: Language Agents with Verbal Reinforcement Learning." NeurIPS 2023.

## 开放讨论

1. **CoT 的"思维过程"真的是在推理吗？** 有人认为 CoT 只是在模仿人类的推理格式，而非真正理解推理逻辑。你怎么看？如果一个数学题的 CoT 推理中间步骤有误但最终答案正确，我们该信任这个答案吗？

2. **Reflexion 的"自我反思"与人类的"元认知"有何本质区别？** 人类的反思可以改变思维方式本身，而 Reflexion 似乎只是在同一思维框架内调整策略。这是否是 AI Agent 实现真正"自我改进"的根本瓶颈？

3. **在什么情况下，"不规划"比"规划"更好？** Plan-and-Execute 并非银弹。对于探索性极强的任务（如开放式研究、创意生成），过度规划反而可能限制 Agent 的探索空间。如何在"规划"和"即兴"之间找到平衡？

---
