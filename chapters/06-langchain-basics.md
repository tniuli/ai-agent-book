# 第6章 LangChain 基础

> 君子生非异也，善假于物也。——《荀子·劝学》

上一章我们用纯 Python 手搓了一个最小 Agent，核心代码不到 100 行。你一定发现了：代码虽然不长，但"体力活"很多——手动拼消息列表、手动解析工具调用、手动管理记忆……每加一个功能，就要在好几个地方改代码。LangChain 就是来帮你做这些"体力活"的。它不是神秘的黑盒，而是一套精心设计的抽象层——把你手写的那些模式，变成了可复用的组件。本章将带你掌握 LangChain 的四大核心抽象（Model / Prompt / Chain / Tool），理解 LCEL（LangChain Expression Language）管道式编程的设计思想，学会用框架优雅地重写第5章的最小 Agent，并了解 LangChain 生态的扩展方向和常见陷阱。第5章从零实现是"知其然"——理解 Agent 本质；本章学框架是"用其利"——用更少的代码做同样的事。

- - -

## 6.1 LangChain 核心抽象

LangChain 就是来帮你做这些"体力活"的。它不是一个神秘的黑盒，而是一套精心设计的抽象层——把你手写的那些模式，变成了可复用的组件。第 5 章从零实现是"知其然"——理解 Agent 本质；本章学框架是"用其利"——用更少的代码做同样的事。

LangChain 的核心抽象只有四个：

```
+---------------------------------------------------+
|                LangChain 核心抽象                  |
|                                                   |
|  +---------+  +---------+  +------+  +--------+ |
|  |  Model   |  | Prompt  |  |Chain |  |  Tool  | |
|  | (模型)  |  | (提示词)|  |(链)  |  | (工具) | |
|  +----┬----+  +----┬----+  +--┬---+  +---┬----+ |
|       |            |          |           |      |
|       +------------┴-----┬----┴-----------+      |
|                          |                        |
|                     +----v-----+                  |
|                     |   LCEL   |                  |
|                     | (管道)   |                  |
|                     +----------+                  |
+---------------------------------------------------+
```

### 6.1.1 Model：与 LLM 对话的统一接口

在第 5 章，我们手写了 `LLMClient` 来封装 OpenAI API。LangChain 做了同样的事，但更进一步——它提供了一个统一的接口 `BaseChatModel`，让你切换模型只改一行代码：

```python
# 第6章裸写
import os
from openai import OpenAI
client = OpenAI(base_url=os.getenv("OPENAI_BASE_URL"))
response = client.chat.completions.create(model="claude-opus-4-7", messages=[...])

# LangChain：统一接口
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="claude-opus-4-7", base_url=os.getenv("OPENAI_BASE_URL"))          # OpenAI
# llm = ChatAnthropic(model="claude-sonnet-4-6")  # 切 Claude 只改这一行
response = llm.invoke("你好")
```

核心区别：**裸写时每个模型的 SDK 不同、参数不同，你写一套适配代码；LangChain 把这些差异封装在了底层，你只跟 `invoke()` 打交道。**

LangChain 中有两种模型接口：

| 接口 | 用途 | 输入 | 输出 |
|------|------|------|------|
| `ChatModel` | 对话场景（主流） | 消息列表 | `AIMessage` |
| `LLM` | 纯文本补全（旧式） | 字符串 | 字符串 |

现在几乎所有场景都用 `ChatModel`，本书也只使用 `ChatModel`。当你看到 `ChatOpenAI`、`ChatAnthropic`，它们都是 `ChatModel` 的实现。

`ChatModel` 的输入输出都是 LangChain 自定义的消息类型：

```python
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

messages = [
    SystemMessage(content="你是一个有用的助手"),
    HumanMessage(content="你好"),
]
response = llm.invoke(messages)
print(type(response))  # <class 'langchain_core.messages.AIMessage'>
print(response.content)  # "你好！有什么我可以帮你的吗？"
```

这和第 5 章手写的 `{"role": "system", "content": "..."}` 本质一样，只是换成了类型安全的对象。

### 6.1.2 Prompt：提示词的模板化

第 5 章我们写系统提示词，是直接用一个字符串常量。但如果提示词需要动态插入变量呢？比如根据用户角色、当前日期、可用工具动态生成——你得手动用 `f-string` 拼接，容易出错。

LangChain 提供了 `PromptTemplate` 和 `ChatPromptTemplate`，让提示词管理变得结构化：

```python
from langchain_core.prompts import ChatPromptTemplate

# 第6章裸写
role = "数据分析助手"
system_prompt = f"你是一个{role}。你可以使用以下工具：..."

# LangChain：模板化
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个{role}。你可以使用以下工具：{tools}"),
    ("human", "{input}"),
])
# 使用时填充变量
formatted = prompt.invoke({"role": "数据分析助手", "tools": "search, calculate", "input": "你好"})
```

📌 **Prompt Engineering 融入点**：`ChatPromptTemplate` 不只是"变量替换"这么简单。它改变了提示词工程的流程——你先把提示词的**结构**定下来（系统消息说什么、用户消息说什么），再把**变量**抽出来。这就像做菜：先把菜谱定好，再根据食材调整。结构稳定了，调优才有方向。我们在 6.2 节会看到，模板和 LCEL 管道结合后，提示词的迭代会变得非常流畅。

`ChatPromptTemplate` 支持多种消息类型：

```python
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个{role}"),           # 系统消息
    ("human", "{input}"),                   # 用户消息
    ("placeholder", "{history}"),           # 占位符——用于对话历史
])
```

其中 `"placeholder"` 配合 `{history}` 可以灵活插入历史消息，这正是 Agent 多轮对话的关键。

### 6.1.3 Chain：把组件串起来

"Chain"是 LangChain 名字的由来——把 Model、Prompt、Tool 串成一条链。但在现代 LangChain 中，Chain 的概念已经被 LCEL（LangChain Expression Language）统一了。你可以把 LCEL 理解为 Chain 的"升级版"——更简洁、更灵活、更强大。

传统的 Chain 长这样：

```python
# 旧式 Chain（不推荐，了解即可）
from langchain.chains import LLMChain
chain = LLMChain(llm=llm, prompt=prompt)
result = chain.run(role="助手", input="你好")
```

LCEL 风格长这样：

```python
# LCEL 管道（推荐）
chain = prompt | llm
result = chain.invoke({"role": "助手", "input": "你好"})
```

那个 `|` 管道符就是 LCEL 的核心语法——和 Linux 管道一样，左边输出是右边输入。我们下一节详细讲。

### 6.1.4 Tool：让 Agent 有手有脚

第 5 章我们手写了 `ToolRegistry`——一个用来注册和管理工具的类。LangChain 提供了更优雅的工具定义方式：

```python
# 第6章裸写：手动注册
registry = ToolRegistry()
registry.register("search", "搜索互联网", {"type": "object", ...}, _mock_search)

# LangChain：装饰器定义
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """搜索互联网获取信息。"""
    return f"搜索结果：关于'{query}'的信息"

# 自动生成 schema，自动注册
```

装饰器方式的好处是：**工具的名字、描述、参数 schema 全都从函数签名自动推导**——`search` 变成工具名，docstring 变成描述，`query: str` 变成参数定义。你不用再手写那坨 JSON Schema 了。

四种核心抽象的关系一目了然：

```
Prompt（构造输入）→ Model（调用 LLM）→ Chain（串联流程）→ Tool（扩展能力）
        |                  |                 |                |
        +------------------┴---------┬-------+                |
                                   |                        |
                            +------v------+                 |
                            |    LCEL     |◄----------------+
                            |  prompt | llm | parser
                            +-------------+
```

- - -

## 6.2 LCEL 详解

LCEL（LangChain Expression Language）是 LangChain 最核心的设计。它用管道符 `|` 把组件串起来，让数据像水流一样从上游流向下游。

### 6.2.1 管道符：从 Linux 到 LangChain

如果你用过 Linux，一定对管道符不陌生：

```bash
cat access.log | grep "ERROR" | wc -l
```

左边输出是右边输入，数据从左往右流。LCEL 把这个思想搬到了 LLM 应用开发中：

```python
chain = prompt | llm | parser
```

含义是：先用 prompt 模板格式化输入 → 再把格式化后的消息发给 LLM → 最后用 parser 解析 LLM 的输出。

### 6.2.2 Runnable：万物皆可管道

LCEL 的魔法来自 `Runnable` 协议——LangChain 中所有可管道化的组件都实现了这个协议。它定义了三个核心方法：

| 方法 | 作用 | 场景 |
|------|------|------|
| `invoke()` | 同步调用，返回单个结果 | 最常用 |
| `stream()` | 流式调用，逐块返回 | 实时输出 |
| `batch()` | 批量调用，并行处理 | 多条输入 |

所有实现了 `Runnable` 的组件都能用 `|` 串联。这意味着：

- `ChatPromptTemplate` 是 Runnable → 可以放在管道最前面
- `ChatOpenAI` 是 Runnable → 可以放在管道中间
- `StrOutputParser` 是 Runnable → 可以放在管道最后
- 你自己写的函数也可以变成 Runnable → 可以插在管道任意位置

```python
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableLambda

# 基本管道
chain = prompt | llm | StrOutputParser()

# 加上自定义处理步骤
def add_prefix(text: str) -> str:
    return f"[Agent] {text}"

chain = prompt | llm | StrOutputParser() | RunnableLambda(add_prefix)

result = chain.invoke({"role": "助手", "input": "你好"})
# "[Agent] 你好！有什么我可以帮你的吗？"
```

### 6.2.3 数据在管道中的流转

理解 LCEL 的关键，是搞清楚数据在各组件之间怎么流转。让我们追踪一次完整的调用：

```
invoke({"role": "助手", "input": "你好"})
        |
        v
+-----------------+
|     Prompt      |  dict → ChatPromptValue
| ChatPromptTemplate|  {"role": "助手", "input": "你好"}
|                 |  → [SystemMessage(...), HumanMessage(...)]
+--------┬--------+
         |
         v
+-----------------+
|      LLM        |  list[Message] → AIMessage
|  ChatOpenAI     |  发给 OpenAI API，返回 AIMessage
+--------┬--------+
         |
         v
+-----------------+
|     Parser      |  AIMessage → str
| StrOutputParser |  提取 .content 字段
+--------┬--------+
         |
         v
    "你好！有什么我可以帮你的吗？"
```

每个组件接收上游的输出，处理后传给下游。`invoke()` 的参数是最左侧组件的输入类型——`ChatPromptTemplate` 接收 `dict`，因为它需要填充模板变量。

### 6.2.4 为什么 LCEL 比传统 Chain 更好

三个关键优势：

**组合性。** 传统 Chain 是预定义的类，功能固定。LCEL 管道可以随意组装，想加一个步骤就多加一个 `|`：

```python
# 加日志
chain = prompt | llm | StrOutputParser() | log_output

# 加重试
chain = prompt | llm.with_retry(stop_after_attempt=3) | StrOutputParser()

# 加输出解析
chain = prompt | llm | PydanticOutputParser(pydantic_object=MyModel)
```

**流式支持。** LCEL 管道自动支持流式输出，不需要你手动处理：

```python
# 同步调用
result = chain.invoke({"role": "助手", "input": "你好"})

# 流式调用——只需换一个方法，管道不变
for chunk in chain.stream({"role": "助手", "input": "你好"}):
    print(chunk, end="", flush=True)
```

**可观测性。** LCEL 管道天然支持 LangSmith 追踪——每个组件的输入输出都会被自动记录，调试时一目了然。

- - -

## 6.3 工具定义与调用

第 5 章我们手写了 `ToolRegistry`，用字典管理工具的注册和调度。LangChain 提供了三种定义工具的方式，从简到繁各有适用场景。

### 6.3.1 @tool 装饰器：最简方式

```python
# 兼容

from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """搜索互联网获取信息。"""
    return f"搜索结果：关于'{query}'的信息"

@tool
def calculate(expression: str) -> str:
    """执行数学计算，接受数学表达式。"""
    allowed = set("0123456789+-*/.() ")
    if not all(c in allowed for c in expression):
        return "错误：表达式包含不允许的字符"
    return f"{expression} = {eval(expression)}"
```

**注意**：`@tool` 装饰器会从函数签名和 docstring 自动推导出工具的 JSON Schema。这意味着：

- **函数名** → 工具名
- **docstring 第一行** → 工具描述
- **参数类型注解** → 参数类型
- **参数的 docstring** → 参数描述（使用 Google 风格 docstring）

如果你想让参数描述更详细：

```python
@tool
def search(query: str) -> str:
    """搜索互联网获取信息。

    Args:
        query: 搜索关键词，如"北京天气"或"Python发明者"
    """
    return f"搜索结果：关于'{query}'的信息"
```

### 6.3.2 StructuredTool：精确控制

当你需要更精细的控制——自定义工具名、添加可选参数、设定默认值——就用 `StructuredTool`：

```python
# 兼容

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

class GetTimeInput(BaseModel):
    """获取日期的参数模型。"""
    offset_days: int = Field(
        default=0,
        description="偏移天数，0=今天，1=明天，-1=昨天",
    )

def _get_time(offset_days: int = 0) -> str:
    from datetime import datetime, timedelta
    target = datetime.now() + timedelta(days=offset_days)
    return target.strftime("%Y年%m月%d日")

get_time = StructuredTool.from_function(
    func=_get_time,
    name="get_time",
    description="获取当前日期，可计算未来日期",
    args_schema=GetTimeInput,
)
```

`StructuredTool` 的优势是**用 Pydantic 模型定义参数**——这意味着参数校验、默认值、嵌套结构都能精确控制。复杂工具推荐这种方式。

### 6.3.3 工具绑定：让 LLM 知道有哪些工具可用

定义好工具后，怎么让 LLM 用它们？答案是 `bind_tools()`：

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="claude-opus-4-7", base_url=os.getenv("OPENAI_BASE_URL"))
tools = [search, calculate, get_time]

# 把工具绑定到 LLM 上
llm_with_tools = llm.bind_tools(tools)

# 调用时 LLM 就知道有哪些工具可用
response = llm_with_tools.invoke("北京今天天气如何？")
# response.tool_calls 包含 LLM 的工具调用请求
```

回忆第 5 章的流程：我们手动构建 `tools` 字段，手动把 JSON Schema 塞进请求。`bind_tools()` 做的就是这件事——只不过它自动帮你完成了。底层仍然是 Function Calling 协议，你理解了第 5 章的原理，这里就是水到渠成。

### 6.3.4 工具执行：从 LLM 的请求到实际调用

LLM 返回 `tool_calls` 后，你需要执行这些工具并把结果回传。LangChain 提供了 `ToolNode` 来简化这个过程：

```python
# 兼容

from langgraph.prebuilt import ToolNode

# ToolNode 自动管理工具执行
tool_node = ToolNode(tools)

# 传入 LLM 的 tool_calls，自动执行并返回结果
tool_results = tool_node.invoke({"messages": [response]})
```

对比第 5 章手写的执行逻辑：

```python
# 第6章
for tc in message.tool_calls:
    result = self.tools.execute(tc.function.name, tc.function.arguments)
    self.memory.add_tool_result(tc.id, result)
```

`ToolNode` 做的事情完全一样，只是封装得更优雅——自动处理参数解析、错误捕获、结果格式化。

### 6.3.5 三种方式对比

| 方式 | 适用场景 | 代码量 | 灵活性 |
|------|---------|--------|--------|
| `@tool` 装饰器 | 简单工具，参数少 | 最少 | 中等 |
| `StructuredTool` | 复杂参数，需要校验 | 中等 | 高 |
| `BaseTool` 子类 | 最复杂，需要自定义执行逻辑 | 最多 | 最高 |

日常开发 90% 的场景用 `@tool` 就够了。需要精确控制参数时用 `StructuredTool`。只有极其特殊的需求才需要继承 `BaseTool`。

- - -

## 6.4 输出解析

LLM 返回的是自由文本，但我们的应用往往需要结构化数据——JSON、Pydantic 对象、列表等。第 5 章我们没做输出解析，Agent 直接返回字符串。但在实际应用中，结构化输出是刚需。

### 6.4.1 StrOutputParser：最简单的解析器

```python
from langchain_core.output_parsers import StrOutputParser

chain = prompt | llm | StrOutputParser()
```

`StrOutputParser` 做的事极其简单：从 `AIMessage` 中提取 `.content` 字段，返回纯字符串。如果你不需要结构化输出，用它就够了。

### 6.4.2 JsonOutputParser：解析 JSON

当你需要 LLM 返回 JSON 格式时：

```python
# 兼容

from langchain_core.output_parsers import JsonOutputParser

parser = JsonOutputParser()

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个数据分析助手。请以 JSON 格式回答。{format_instructions}"),
    ("human", "{input}"),
])

chain = prompt | llm | parser

result = chain.invoke({
    "input": "分析Python和Java的优缺点",
    "format_instructions": parser.get_format_instructions(),
})
# result 是一个 dict
```

`parser.get_format_instructions()` 会生成一段提示词，告诉 LLM 应该返回什么格式的 JSON。这是 LangChain 的巧妙设计——**解析器不仅负责"解析"，还负责"指导 LLM 生成可解析的输出"**。

### 6.4.3 PydanticOutputParser：类型安全的解析

`JsonOutputParser` 只能给你一个 `dict`，没有类型检查。`PydanticOutputParser` 让你直接拿到 Pydantic 模型实例：

```python
# 兼容

from langchain_core.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field

class WeatherReport(BaseModel):
    """天气报告。"""
    city: str = Field(description="城市名")
    temperature: int = Field(description="气温（摄氏度）")
    condition: str = Field(description="天气状况，如晴、多云、雨")
    suggestion: str = Field(description="出行建议")

parser = PydanticOutputParser(pydantic_object=WeatherReport)

prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个天气分析助手。{format_instructions}"),
    ("human", "{input}"),
])

chain = prompt | llm | parser

result = chain.invoke({
    "input": "北京今天天气晴，22度",
    "format_instructions": parser.get_format_instructions(),
})
# result 是 WeatherReport 实例
print(result.city)        # "北京"
print(result.suggestion)  # "天气不错，适合户外活动"
```

`PydanticOutputParser` 的两大优势：

1. **自动生成格式指令**：`get_format_instructions()` 会把 Pydantic 模型的字段名、类型、描述翻译成提示词，指导 LLM 按格式输出
2. **自动校验**：如果 LLM 的输出不符合模型定义，会抛出 `OutputParserException`，你可以捕获后重试

### 6.4.4 with_structured_output：更优雅的方式

LangChain 还提供了一个更简洁的方法——直接让 LLM 返回结构化输出：

```python
# 兼容

class WeatherReport(BaseModel):
    city: str = Field(description="城市名")
    temperature: int = Field(description="气温")
    condition: str = Field(description="天气状况")
    suggestion: str = Field(description="出行建议")

# 直接绑定 Pydantic 模型
structured_llm = llm.with_structured_output(WeatherReport)

result = structured_llm.invoke("分析北京今天的天气：晴，22度")
# result 直接是 WeatherReport 实例！
```

`with_structured_output()` 底层会根据模型能力选择最佳策略——支持 Function Calling 的模型（如 GPT-5.5）用它来做结构化输出，不支持的则退回到提示词 + 解析器模式。你不用关心底层细节，一个方法搞定。

三种解析方式的选择：

| 方式 | 输出类型 | 何时用 |
|------|---------|--------|
| `StrOutputParser` | `str` | 不需要结构化 |
| `JsonOutputParser` | `dict` | 需要 JSON 但不想要类型检查 |
| `PydanticOutputParser` | Pydantic Model | 需要类型安全 |
| `with_structured_output()` | Pydantic Model | 最推荐，最简洁 |

- - -

## 6.5 实战

到了实战环节——用 LangChain 重写第 5 章的最小 Agent。我们要做的是同一个东西，但代码会更少、更清晰、更易维护。

在开始之前，先提醒两个 LCEL 管道搭建时最容易踩的坑：一是**类型不匹配**——LCEL 用 `|` 串联组件时，上游输出类型必须与下游输入类型兼容，否则运行时报错；尤其常见的是在管道中插入普通函数却忘记用 `RunnableLambda` 包装，导致 `|` 运算符无法识别。二是**模板变量名不一致**——`ChatPromptTemplate` 的变量名与代码中的 key 对不上时，模板渲染会静默失败，排查起来非常耗时。建议的做法是：搭建完管道后先用 `chain.get_graph()` 打印 DAG 图确认类型流转是否正确，同时确保所有自定义函数都用 `RunnableLambda` 包装、模板变量名与代码 key 严格对齐。

先回顾第 5 章的 Agent 架构：

```
用户输入 → 记忆追加 → LLM 推理 → 判断是否调用工具
                                      ├-- 是 → 执行工具 → 结果追加记忆 → 回到 LLM
                                      +-- 否 → 返回最终回答
```

这个架构不变。变的是实现方式。

### 6.5.1 对比总览：裸写 vs 框架

| 维度 | Ch6 裸写 | Ch7 LangChain |
|------|---------|---------------|
| 工具注册 | 手写 `ToolRegistry`（~90行） | `@tool` 装饰器（~20行） |
| 消息管理 | 手写 `ConversationMemory`（~50行） | LangGraph 内置状态管理 |
| LLM 调用 | 手写 `LLMClient` 封装 | `ChatOpenAI` 开箱即用 |
| 提示词 | 字符串常量 + f-string | `ChatPromptTemplate` |
| Agent 循环 | 手写 for 循环 + 工具调度 | `create_react_agent` 一行搞定 |
| 输出解析 | 无 | `with_structured_output` |
| 总代码量 | ~250 行 | ~80 行 |

### 6.5.2 工具定义：从 ToolRegistry 到 @tool

先看工具定义的对比。

**Ch6 裸写（tools.py）：**

```python
class ToolRegistry:
    def __init__(self):
        self._tools = {}
        self._schemas = []

    def register(self, name, description, parameters, func):
        self._tools[name] = func
        self._schemas.append({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            },
        })

    def get_schemas(self):
        return self._schemas

    def execute(self, name, arguments):
        if name not in self._tools:
            return f"错误：未知工具 '{name}'"
        args = json.loads(arguments)
        return self._tools[name](**args)

# 手动注册三个工具...
registry = ToolRegistry()
registry.register("search", "搜索互联网获取信息",
    {"type": "object", "properties": {"query": {"type": "string", ...}}, ...},
    _mock_search)
# ... calculate, get_time 类似
```

**Ch7 LangChain（tools.py）：**

```python
from langchain_core.tools import tool

@tool
def search(query: str) -> str:
    """搜索互联网获取信息。"""
    results = {
        "北京天气": "北京今天晴，气温 22°C，微风。",
        "上海天气": "上海今天多云，气温 25°C，东南风3级。",
    }
    for key, val in results.items():
        if key in query:
            return val
    return f"搜索结果：关于'{query}'，暂无详细信息。"

@tool
def calculate(expression: str) -> str:
    """执行数学计算，接受数学表达式。"""
    allowed = set("0123456789+-*/.() ")
    if not all(c in allowed for c in expression):
        return "错误：表达式包含不允许的字符"
    return f"{expression} = {eval(expression)}"

@tool
def get_time(offset_days: int = 0) -> str:
    """获取当前日期，可计算未来日期。"""
    from datetime import datetime, timedelta
    target = datetime.now() + timedelta(days=offset_days)
    return target.strftime("%Y年%m月%d日")
```

从 ~90 行缩减到 ~20 行，关键差异在于：

- 不需要手写 `ToolRegistry`：`@tool` 装饰器自动完成注册
- 不需要手写 JSON Schema：从函数签名和 docstring 自动推导
- 不需要手写参数解析：LangChain 自动处理 `json.loads` 和参数映射

### 6.5.3 提示词：从字符串到模板

**Ch6 裸写：**

```python
SYSTEM_PROMPT = """你是一个有用的 AI 助手。你可以使用以下工具来帮助用户：

1. search - 搜索互联网获取信息
2. calculate - 执行数学计算
3. get_time - 获取当前日期或计算未来日期

工作方式：
- 先思考用户需要什么信息
- 如果需要，调用合适的工具
- 根据工具返回的结果，组织最终回答

如果不需要工具就能回答，直接回答即可。"""
```

**Ch7 LangChain：**

```python
from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    ("placeholder", "{history}"),
    ("human", "{input}"),
])
```

模板化的好处在第 6.1.2 节讲过了——结构稳定，变量可插拔。特别是 `("{history}")` 占位符，让对话历史的注入变得优雅——不用像第 5 章那样手动拼消息列表。

📌 **Prompt Engineering 融入点**：从裸写字符串到 `ChatPromptTemplate`，不只是语法糖，而是提示词工程的方法论升级。模板把提示词的**骨架**和**血肉**分离——骨架是消息结构（系统消息、用户消息、历史消息），血肉是具体内容。调优时你只需要关注内容，结构不用动。这就像毛笔字——先练间架结构，再练笔法神韵，骨架稳了，写什么都好看。

### 6.5.4 Agent 循环：从手写循环到 create_react_agent

这是最关键的对比。第 5 章我们手写了整个 ReAct 循环——for 循环、工具调用判断、消息管理、记忆追加，每一步都是手动代码。LangGraph 提供了 `create_react_agent`，一个方法搞定：

**Ch6 裸写（agent.py）：**

```python
class ReActAgent:
    def run(self, user_input):
        self.memory.add("user", user_input)
        for i in range(self.max_iterations):
            response = self.llm.chat(
                messages=self.memory.get_messages(),
                tools=self.tools.get_schemas(),
            )
            message = response.choices[0].message
            if not message.tool_calls:
                answer = message.content or ""
                self.memory.add("assistant", answer)
                return answer
            # 手动处理 tool_calls...
            self.memory.add("assistant", message.content or "",
                tool_calls=[...])
            for tc in message.tool_calls:
                result = self.tools.execute(tc.function.name, tc.function.arguments)
                self.memory.add_tool_result(tc.id, result)
        return "抱歉，我无法在限定步骤内完成这个任务。"
```

**Ch7 LangChain（agent.py）：**

```python
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(
    model=llm,
    tools=[search, calculate, get_time],
    prompt=SYSTEM_PROMPT,
)
result = agent.invoke({"messages": [("user", "北京今天天气如何？")]})
answer = result["messages"][-1].content
```

四行核心代码 vs 六十行手写循环。`create_react_agent` 帮你做了：

- ReAct 循环：自动实现"思考→行动→观察"的循环
- 工具调度：自动解析 `tool_calls`、执行工具、回传结果
- 状态管理：自动维护对话历史，不需要手动管理消息列表
- 终止条件：LLM 不再调用工具时自动终止
- 错误处理：工具调用失败时的默认处理逻辑

这不是魔法，只是框架把第 5 章你手写的那些模式，封装成了可复用的组件。你理解了第 5 章的原理，这里的每一步你都能对应到。

### 6.5.5 完整代码对比

让我们把完整的运行示例放在一起。

**Ch6 裸写（main.py）：**

```python
from agent import ReActAgent
from memory import ConversationMemory
from tools import create_mock_registry
from llm_client import LLMClient, LLMConfig

SYSTEM_PROMPT = "你是一个有用的 AI 助手。你可以使用以下工具..."

config = LLMConfig(model="claude-opus-4-7", temperature=0.7)
llm = LLMClient(config)
tools = create_mock_registry()
memory = ConversationMemory(system_prompt=SYSTEM_PROMPT)
agent = ReActAgent(tool_registry=tools, memory=memory,
                   llm_client=llm, max_iterations=5)

response = agent.chat("北京今天天气如何？")
print(response)
```

**Ch7 LangChain（main.py）：**

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from tools import search, calculate, get_time

SYSTEM_PROMPT = "你是一个有用的 AI 助手。你可以使用以下工具..."

llm = ChatOpenAI(model="claude-opus-4-7", temperature=0.7, base_url=os.getenv("OPENAI_BASE_URL"))
agent = create_react_agent(
    model=llm,
    tools=[search, calculate, get_time],
    prompt=SYSTEM_PROMPT,
)

result = agent.invoke({"messages": [("user", "北京今天天气如何？")]})
print(result["messages"][-1].content)
```

核心代码从 ~20 行减到 ~10 行，更重要的是**概念负担大幅降低**——你不需要关心 `ToolRegistry`、`ConversationMemory`、`LLMClient` 这些手写实现，框架帮你管了。
### 6.5.6 多轮对话：状态管理对比

第 5 章的多轮对话靠 `ConversationMemory` 手动管理消息列表。LangGraph 的 Agent 天然支持多轮——你只需要把之前的消息传进去：

```python
# 兼容

# 第一轮
result1 = agent.invoke({"messages": [("user", "你好")]})
# result1["messages"] 包含

# 第二轮——把上一轮的消息传进去
result2 = agent.invoke({"messages": result1["messages"] + [("user", "北京天气如何？")]})
# result2["messages"] 包含
```

状态不在 Agent 内部维护，而是作为参数传入——这种"无状态"设计让 Agent 更灵活、更容易测试。

- - -

## 6.6 进阶拓展

### 6.6.1 自定义 Runnable：打造你的管道组件

LCEL 的管道不止能串 LangChain 内置组件，你自己写的函数也能插进去。有两种方式：

```python
from langchain_core.runnables import RunnableLambda, RunnableConfig

# 方式1
def add_context(text: str) -> str:
    return f"[来自AI助手] {text}"

chain = prompt | llm | StrOutputParser() | RunnableLambda(add_context)

# 方式2：装饰器——更简洁
from langchain_core.runnables import runnable

@runnable
def add_context(text: str) -> str:
    return f"[来自AI助手] {text}"

chain = prompt | llm | StrOutputParser() | add_context
```

自定义 Runnable 在这些场景特别有用：日志记录、输出后处理、格式转换、条件路由。

### 6.6.2 LCEL 的并行与分支

LCEL 支持并行执行多个管道，用 `RunnableParallel`：

```python
from langchain_core.runnables import RunnableParallel

# 同时用两种风格回答
parallel = RunnableParallel(
    formal=prompt_formal | llm | StrOutputParser(),
    casual=prompt_casual | llm | StrOutputParser(),
)

result = parallel.invoke({"input": "解释什么是 Agent"})
print(result["formal"])  # 正式版回答
print(result["casual"])  # 口语版回答
```

这在 A/B 测试提示词、多模型对比、多角度分析等场景中非常实用。

### 6.6.3 带 fallback 的管道：优雅降级

当主模型不可用时，自动切换到备用模型：

```python
primary_llm = ChatOpenAI(model="claude-opus-4-7", base_url=os.getenv("OPENAI_BASE_URL"))
fallback_llm = ChatOpenAI(model="claude-sonnet-4-6", base_url=os.getenv("OPENAI_BASE_URL"))

chain = prompt | primary_llm.with_fallbacks([fallback_llm]) | StrOutputParser()

# Claude Opus 4.7 失败时自动尝试 Claude Sonnet 4.6
result = chain.invoke({"input": "你好"})
```

生产环境中，fallback 是必备的——API 不保证 100% 可用，优雅降级比直接报错好得多。

- - -

## 进阶必做

1. **用 StructuredTool 重写工具**：将 6.5.2 中的 `get_time` 工具从 `@tool` 装饰器风格改为 `StructuredTool` 风格，使用 Pydantic 模型定义参数。要求 `offset_days` 必须在 -365 到 365 之间。思考：`@tool` 自动推导的 schema 能表达这种约束吗？

2. **构建带输出解析的 LCEL 管道**：用 `ChatPromptTemplate` + `ChatOpenAI` + `PydanticOutputParser` 构建一个管道，接收问题，返回包含 `answer`（str）和 `confidence`（float，0-1）的 Pydantic 模型实例。

3. **对比 create_react_agent 和手写 ReAct 循环**：运行 `ch06/main.py` 和 `ch05/minimal_agent/main.py`，用相同问题测试。观察两者的回答是否一致？追踪决策链路，找到对应步骤。

## 参考文献

1. LangChain Documentation. https://python.langchain.com/
2. Harrison, C. "LangChain: Building Applications with LLMs through Composability." 2022.

## 开放讨论

1. **"善假于物"的边界在哪里？** 框架帮我们省力，但也增加了学习成本和依赖风险。什么时候应该用框架，什么时候应该自己写？如果 LangChain 某天停止维护了，你的项目怎么办？怎样在"借力"和"自主"之间找到平衡？

2. **LCEL 的管道哲学与 Unix 管道有何异同？** Unix 管道是"数据流"，LCEL 管道也是"数据流"——但 LCEL 的每个组件是有类型的（输入类型、输出类型）。这种类型约束是优势还是限制？如果把 LCEL 管道比作"水渠"，类型约束就像渠壁——它防止水漫出来，但也限制了水的流向。你怎么看？

3. **工具自动推导 vs 手动定义：哪个更可靠？** `@tool` 装饰器从函数签名自动推导 JSON Schema，省事但可能推导不准确。手动写 `StructuredTool` 精确但繁琐。在生产环境中，你会如何选择？
