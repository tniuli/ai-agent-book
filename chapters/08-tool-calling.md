# 第8章 工具调用

> 备物致用，立成器以为天下利。——《易经·系辞上》

在前面的章节中，我们已经见识了 Agent 的推理与规划能力。但一个只会"想"不会"做"的 Agent，就像一个纸上谈兵的谋士——纵有千般妙计，终究无法落地。工具调用（Tool Calling），正是让 Agent 从"坐而论道"走向"起而行之"的关键桥梁。

第 6 章我们学习了 Function Calling 的基础用法——如何定义一个函数、如何让模型返回调用指令、如何执行并回传结果。那是最基本的"给 Agent 一把锤子"。本章，我们要更上一层楼：多把工具并发挥舞、工具之间嵌套配合、通过 MCP 协议让工具生态互通、以及如何安全可靠地开发与部署自定义工具。

- - -

## 8.1 Function Calling 协议深度解析

### 8.1.1 回顾：第6章的基础模式

在第6章中，我们建立了 Function Calling 的基本认知：

```
用户提问 → 模型判断是否需要工具 → 返回工具调用指令 → 执行工具 → 回传结果 → 模型生成最终回答
```

核心流程是一个简单的循环：**判断 → 调用 → 回传 → 生成**。当时我们处理的场景也比较简单——单轮对话、单个工具、一次调用就够。

但现实世界的问题往往不是一把锤子就能搞定的。这里需要特别留意工具调用的串并行问题：当多个工具有依赖关系（后一个依赖前一个的结果）时，如果误用了并发模式同时发起调用，后调用的工具会因缺少前置数据而返回错误，甚至触发连锁超时——第一个工具慢了，后续依赖它的工具全部跟着超时。即使工具之间逻辑独立，某个工具的超时也可能拖慢整个 Agent 的响应时间，让用户侧感知到"卡住"。所以实践中要严格区分串行与并行：有依赖关系的必须串行，独立的才可并行；同时为每个工具设置独立的超时阈值而非全局统一超时，并在超时后返回降级结果而非阻塞等待。

### 8.1.2 多工具并发调用

当用户的问题涉及多个独立信息源时，模型可以在一次响应中同时请求调用多个工具。这不仅仅是语法糖——它是真正提升 Agent 响应速度的关键能力。

**场景**：用户问"北京和上海今天的天气如何，以及两地明天的航班情况？"

这个问题的四个信息源（北京天气、上海天气、北京航班、上海航班）彼此独立，完全可以并行获取：

```python
# ch08_multitool_parallel.py
# 版本: v1.0
# 多工具并发调用示例

import openai
import json
import asyncio

client = openai.OpenAI()

# 定义工具
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如'北京'、'上海'"
                    }
                },
                "required": ["city"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_flights",
            "description": "查询航班信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "departure": {
                        "type": "string",
                        "description": "出发城市"
                    },
                    "destination": {
                        "type": "string",
                        "description": "目的城市"
                    },
                    "date": {
                        "type": "string",
                        "description": "日期，格式 YYYY-MM-DD"
                    }
                },
                "required": ["departure", "destination", "date"]
            }
        }
    }
]

# 模拟工具实现
def get_weather(city: str) -> dict:
    """模拟天气查询"""
    weather_data = {
        "北京": {"temperature": 28, "condition": "晴", "humidity": 35},
        "上海": {"temperature": 32, "condition": "多云", "humidity": 72},
    }
    return weather_data.get(city, {"error": f"未找到{city}的天气数据"})

def get_flights(departure: str, destination: str, date: str) -> dict:
    """模拟航班查询"""
    return {
        "departure": departure,
        "destination": destination,
        "date": date,
        "flights": [
            {"flight_no": "CA1234", "departure_time": "08:00", "price": 980},
            {"flight_no": "MU5678", "departure_time": "14:30", "price": 750},
        ]
    }

# 工具执行映射
tool_map = {
    "get_weather": get_weather,
    "get_flights": get_flights,
}

def run_multi_tool_conversation(user_message: str):
    """多工具并发调用主流程"""

    messages = [{"role": "user", "content": user_message}]

    # 第一步
    response = client.chat.completions.create(
        model="claude-opus-4-7",
        messages=messages,
        tools=tools,
        tool_choice="auto",  # 自动决定是否调用工具
    )

    message = response.choices[0].message
    messages.append(message)

    # 第二步
    if message.tool_calls:
        print(f"模型请求调用 {len(message.tool_calls)} 个工具：")
        for tc in message.tool_calls:
            print(f"  - {tc.function.name}({tc.function.arguments})")

        # 并发执行所有工具调用
        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)

            # 调用对应的工具函数
            result = tool_map[function_name](**function_args)

            # 将结果追加到消息列表
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

        # 第三步
        final_response = client.chat.completions.create(
            model="claude-opus-4-7",
            messages=messages,
            tools=tools,
        )
        return final_response.choices[0].message.content

    return message.content


if __name__ == "__main__":
    result = run_multi_tool_conversation(
        "北京和上海今天的天气如何？明天从北京到上海有什么航班？"
    )
    print("\n最终回答：")
    print(result)
```

运行这段代码，你会看到模型在一次响应中同时请求了三个工具调用：`get_weather("北京")`、`get_weather("上海")`、`get_flights("北京", "上海", "2026-05-23")`。我们依次执行后，将结果一次性回传，模型就能综合所有信息给出完整回答。

**关键点**：多工具并发不是我们手动控制的，而是模型根据问题自主判断的。`tool_choice="auto"` 让模型自由决定调用哪些工具、调用几次。当问题天然可以分解为多个独立子问题时，模型会自动并行请求。

### 8.1.3 嵌套工具调用：工具链

有些问题不是并行的，而是串行的——后一个工具的调用依赖前一个工具的结果。这就是**工具链（Tool Chaining）**。

**场景**：用户问"帮我查一下《三体》的作者，然后看看他还有什么其他著作？"

这个问题的两步有依赖关系：必须先查出作者，才能查作者的其他著作。模型需要先调用"查书籍信息"工具，拿到作者名后，再调用"查作者作品"工具。

```python
# ch08_tool_chaining.py
# 版本: v1.0
# 嵌套工具调用（工具链）示例

import openai
import json

client = openai.OpenAI()

tools = [
    {
        "type": "function",
        "function": {
            "name": "search_book",
            "description": "根据书名搜索书籍信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "书名"}
                },
                "required": ["title"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_author_works",
            "description": "根据作者名查询其所有著作",
            "parameters": {
                "type": "object",
                "properties": {
                    "author": {"type": "string", "description": "作者名"}
                },
                "required": ["author"]
            }
        }
    }
]

def search_book(title: str) -> dict:
    books = {
        "三体": {"title": "三体", "author": "刘慈欣", "year": 2008, "genre": "科幻"},
        "活着": {"title": "活着", "author": "余华", "year": 1993, "genre": "文学"},
    }
    return books.get(title, {"error": f"未找到《{title}》"})

def search_author_works(author: str) -> dict:
    works = {
        "刘慈欣": ["三体", "三体II：黑暗森林", "三体III：死神永生", "流浪地球", "球状闪电"],
        "余华": ["活着", "许三观卖血记", "兄弟", "在细雨中呼喊"],
    }
    return {"author": author, "works": works.get(author, [])}

tool_map = {
    "search_book": search_book,
    "search_author_works": search_author_works,
}

def run_tool_chain(user_message: str, max_rounds: int = 5):
    """支持多轮工具调用的对话循环"""

    messages = [{"role": "user", "content": user_message}]

    for round_num in range(max_rounds):
        response = client.chat.completions.create(
            model="claude-opus-4-7",
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )

        message = response.choices[0].message
        messages.append(message)

        # 如果没有工具调用，说明模型已经可以给出最终回答
        if not message.tool_calls:
            return message.content

        print(f"--- 第 {round_num + 1} 轮工具调用 ---")
        for tool_call in message.tool_calls:
            function_name = tool_call.function.name
            function_args = json.loads(tool_call.function.arguments)
            print(f"  调用: {function_name}({function_args})")

            result = tool_map[function_name](**function_args)
            print(f"  结果: {result}")

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })

    return "达到最大工具调用轮数限制"


if __name__ == "__main__":
    result = run_tool_chain("帮我查一下《三体》的作者，然后看看他还有什么其他著作？")
    print(f"\n最终回答：\n{result}")
```

这个实现的核心是一个**循环**：每次模型返回工具调用，我们就执行并回传，然后让模型继续判断是否还需要更多工具。直到模型不再请求工具，直接给出文字回答，循环结束。

> 古语点睛："善假于物"不只是会用一样工具，更在于让工具与工具之间首尾相接、环环相扣，形成一条完整的能力链。

### 8.1.4 工具选择策略

`tool_choice` 参数决定了模型如何选择工具，它有几种策略：

| 策略 | 值 | 说明 | 适用场景 |
|------|-----|------|----------|
| 自动 | `"auto"` | 模型自主决定是否调用工具及调用哪个 | 大多数场景 |
| 强制调用 | `"required"` | 模型必须调用至少一个工具 | 确保不直接回答 |
| 指定工具 | `{"type": "function", "function": {"name": "xxx"}}` | 强制调用指定工具 | 流程控制 |
| 禁用 | `"none"` | 禁止调用任何工具 | 纯对话场景 |

**实战建议**：

1. 默认用 `auto`：让模型自主判断，这是最灵活的策略
2. 流程化场景用 `required` 或指定工具：比如你的 Agent 流程要求第一步必须查数据库，那就用指定工具策略强制走查库路径
3. 注意 `none` 的使用：有些场景你确实需要模型"闭嘴思考"而不调用工具，比如在生成方案阶段

```python
# 策略一：强制必须调用工具（不指定哪个）
response = client.chat.completions.create(
    model="claude-opus-4-7",
    messages=messages,
    tools=tools,
    tool_choice="required",
)

# 策略二：强制调用指定工具
response = client.chat.completions.create(
    model="claude-opus-4-7",
    messages=messages,
    tools=tools,
    tool_choice={"type": "function", "function": {"name": "get_weather"}},
)

# 策略三：禁止调用工具（纯对话）
response = client.chat.completions.create(
    model="claude-opus-4-7",
    messages=messages,
    tools=tools,
    tool_choice="none",
)
```

### 8.1.5 工具定义的精确性原则

回顾第6章我们讲过，工具定义的质量直接决定模型调用的准确性。这里要进一步强调：**工具定义不是文档，而是契约**。

一个精确的工具定义要做到：

1. 描述要消除歧义：不要写"获取数据"，要写"根据城市名称获取该城市当前天气信息，包括温度、湿度、天气状况"
2. 参数类型要严格：枚举值用 `enum` 约束，数值范围用 `minimum`/`maximum` 限定
3. 必填与选填要分明：`required` 数组只放真正必须的参数，可选参数提供默认值说明
4. 返回格式要文档化：在 `description` 中说明返回值的结构

```json
{
    "type": "function",
    "function": {
        "name": "query_order",
        "description": "根据订单ID查询订单详情，返回订单状态、商品列表、总金额和物流信息。如果订单不存在，返回error字段。",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "订单ID，格式为ORD-开头的16位字符串，如ORD-20260522000001",
                    "pattern": "^ORD-[0-9]{12}$"
                },
                "include_logistics": {
                    "type": "boolean",
                    "description": "是否包含物流信息，默认为true"
                }
            },
            "required": ["order_id"]
        }
    }
}
```

> 古语点睛："工欲善其事，必先利其器"——工具定义就是那把"器"的图纸。图纸越精确，打造出来的器就越趁手。在第6章我们讲了这个道理，本章我们把它推到极致：参数的 `pattern` 校验、`enum` 约束、返回值文档化，都是让图纸从"能用"变成"好用"的关键打磨。

- - -

## 8.2 LangChain 的工具体系

如果说原生 Function Calling 是"手工锻造"，那 LangChain 的工具体系就是"标准化生产"。它提供了标准化的工具抽象、便捷的装饰器语法、以及丰富的预置工具库，让我们能快速构建可复用的工具集。

### 8.2.1 三种工具定义方式

LangChain 提供了三种定义工具的方式，适用于不同复杂度的场景：

```
@tool 装饰器 ---- 最简单，适合快速原型
    |
BaseTool 继承 ---- 最灵活，适合复杂逻辑
    |
StructuredTool ---- 最精确，适合需要精细控制参数的场景
```

**方式一：`@tool` 装饰器**

最简单直接的方式，用装饰器将普通函数变为工具：

```python
# ch08_langchain_tools.py
# 版本: v1.0
# LangChain 工具体系示例

from langchain_core.tools import tool, BaseTool, StructuredTool
from pydantic import BaseModel, Field
from typing import Optional, Type


# ========== 方式一

@tool
def calculate_bmi(weight_kg: float, height_m: float) -> str:
    """计算BMI指数。weight_kg为体重（千克），height_m为身高（米）。"""
    bmi = weight_kg / (height_m ** 2)
    if bmi < 18.5:
        category = "偏瘦"
    elif bmi < 24:
        category = "正常"
    elif bmi < 28:
        category = "偏胖"
    else:
        category = "肥胖"
    return f"BMI = {bmi:.1f}，属于{category}范围"


# ========== 方式二

class WeatherTool(BaseTool):
    name: str = "get_weather"
    description: str = "获取指定城市的当前天气信息"

    # 定义输入参数的Schema
    args_schema: Type[BaseModel] = None  # 稍后定义

    def _run(self, city: str, unit: str = "celsius") -> str:
        """同步执行"""
        # 模拟天气数据
        weather = {
            "北京": {"temp": 28, "condition": "晴"},
            "上海": {"temp": 32, "condition": "多云"},
            "广州": {"temp": 35, "condition": "雷阵雨"},
        }
        data = weather.get(city)
        if not data:
            return f"未找到{city}的天气数据"

        temp = data["temp"]
        if unit == "fahrenheit":
            temp = temp * 9 / 5 + 32
            return f"{city}：{data['condition']}，温度{temp:.0f}°F"
        return f"{city}：{data['condition']}，温度{temp}°C"

    async def _arun(self, city: str, unit: str = "celsius") -> str:
        """异步执行"""
        # 实际项目中这里可以是异步HTTP请求
        return self._run(city, unit)


# 为 WeatherTool 定义输入Schema
from pydantic import BaseModel, Field

class WeatherInput(BaseModel):
    city: str = Field(description="城市名称，如'北京'、'上海'")
    unit: str = Field(default="celsius", description="温度单位：celsius 或 fahrenheit")

WeatherTool.args_schema = WeatherInput


# ========== 方式三

class StockQueryInput(BaseModel):
    symbol: str = Field(description="股票代码，如'AAPL'、'600519'")
    period: str = Field(default="1d", description="查询周期：1d/5d/1m/3m/1y")

def query_stock(symbol: str, period: str = "1d") -> str:
    """查询股票行情"""
    # 模拟股票数据
    stocks = {
        "AAPL": {"name": "Apple", "price": 198.5, "change": "+1.2%"},
        "600519": {"name": "贵州茅台", "price": 1680.0, "change": "-0.5%"},
        "TSLA": {"name": "Tesla", "price": 245.3, "change": "+3.1%"},
    }
    data = stocks.get(symbol)
    if not data:
        return f"未找到股票代码 {symbol}"
    return f"{data['name']}({symbol})：价格 {data['price']}，涨跌幅 {data['change']}（周期:{period}）"

stock_tool = StructuredTool.from_function(
    func=query_stock,
    name="query_stock",
    description="查询股票行情信息，支持A股和美股代码",
    args_schema=StockQueryInput,
    return_direct=False,  # 如果为True，工具结果直接返回给用户，不经过模型
)


# ========== 使用工具 ==========

def demo_tool_definitions():
    """演示三种工具定义方式"""

    # 查看工具的名称和描述
    print("=== @tool 装饰器 ===")
    print(f"名称: {calculate_bmi.name}")
    print(f"描述: {calculate_bmi.description}")
    print(f"参数Schema: {calculate_bmi.args_schema.model_json_schema()}")

    print("\n=== BaseTool 继承 ===")
    weather = WeatherTool()
    print(f"名称: {weather.name}")
    print(f"描述: {weather.description}")
    result = weather._run(city="北京")
    print(f"执行结果: {result}")

    print("\n=== StructuredTool ===")
    print(f"名称: {stock_tool.name}")
    print(f"描述: {stock_tool.description}")
    result = stock_tool.invoke({"symbol": "AAPL", "period": "5d"})
    print(f"执行结果: {result}")


if __name__ == "__main__":
    demo_tool_definitions()
```

三种方式对比：

| 特性 | @tool | BaseTool | StructuredTool |
|------|-------|----------|----------------|
| 定义难度 | 最低 | 中等 | 中等 |
| 参数校验 | 自动从类型注解推导 | 需定义 args_schema | 需定义 args_schema |
| 异步支持 | 自动生成 | 需实现 `_arun` | 需传 `coroutine` |
| 灵活度 | 低 | 最高 | 高 |
| 适用场景 | 简单函数 | 复杂状态/逻辑 | 需要精确参数控制 |

**选择建议**：简单工具用 `@tool`，一秒搞定；需要维护状态或复杂逻辑用 `BaseTool`；需要精细控制参数校验和返回行为用 `StructuredTool`。

### 8.2.2 工具绑定与 Agent 执行

定义好工具后，需要把它们绑定到模型和 Agent 上。LangChain 提供了 `bind_tools()` 方法将工具绑定到聊天模型：

```python
# ch08_langchain_agent.py
# 版本: v1.0
# LangChain Agent 工具绑定与执行

from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate
import json


# 定义工具集
@tool
def search_product(name: str) -> str:
    """根据商品名称搜索商品信息，返回价格、库存和评分。"""
    products = {
        "iPhone 16": {"price": 7999, "stock": 120, "rating": 4.8},
        "MacBook Pro": {"price": 14999, "stock": 45, "rating": 4.9},
        "AirPods Pro": {"price": 1899, "stock": 300, "rating": 4.7},
    }
    product = products.get(name)
    if product:
        return json.dumps({"name": name, **product}, ensure_ascii=False)
    return f"未找到商品：{name}"


@tool
def calculate_discount(original_price: float, discount_percent: float) -> str:
    """计算折扣后的价格。original_price为原价，discount_percent为折扣百分比（如20表示八折）。"""
    discounted = original_price * (1 - discount_percent / 100)
    saved = original_price - discounted
    return f"原价 ¥{original_price:.2f}，折扣 {discount_percent}%，折后 ¥{discounted:.2f}，节省 ¥{saved:.2f}"


@tool
def check_inventory(product_name: str, quantity: int) -> str:
    """检查商品库存是否充足。product_name为商品名称，quantity为所需数量。"""
    # 模拟库存检查
    stock = {"iPhone 16": 120, "MacBook Pro": 45, "AirPods Pro": 300}
    available = stock.get(product_name, 0)
    if available >= quantity:
        return f"库存充足：{product_name} 当前库存 {available}，需要 {quantity}"
    return f"库存不足：{product_name} 当前库存 {available}，需要 {quantity}，缺口 {quantity - available}"


def run_agent():
    """使用 LangChain Agent 执行工具调用"""

    # 初始化模型
    llm = ChatOpenAI(model="claude-opus-4-7", temperature=0, base_url=os.getenv("OPENAI_BASE_URL"))

    # 工具列表
    tools = [search_product, calculate_discount, check_inventory]

    # 创建提示模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", "你是一个电商购物助手，可以帮助用户查询商品、计算折扣、检查库存。请用中文回答。"),
        ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    # 创建 Agent
    agent = create_tool_calling_agent(llm, tools, prompt)

    # 创建 Agent 执行器
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,          # 打印详细执行过程
        max_iterations=5,      # 最大迭代次数
        handle_parsing_errors=True,  # 处理解析错误
    )

    # 执行
    result = agent_executor.invoke({
        "input": "我想买3台 MacBook Pro，打85折后多少钱？库存够吗？"
    })

    print(f"\n最终回答：{result['output']}")
    return result


if __name__ == "__main__":
    run_agent()
```

运行时你会看到 Agent 自主完成了三步：查商品信息 → 计算折扣 → 检查库存，最后综合回答用户。

### 8.2.3 LangChain 预置工具库

LangChain 内置了大量常用工具，无需从零开发：

| 类别 | 工具示例 | 说明 |
|------|----------|------|
| 搜索 | `TavilySearchResults` | 网络搜索 |
| 数学 | `WolframAlphaQueryRun` | 数学计算 |
| 代码 | `PythonREPL` | 执行 Python 代码 |
| 文件 | `ReadFileTool`, `WriteFileTool` | 文件读写 |
| 数据库 | `SQLDatabaseTool` | SQL 查询 |
| API | `RequestsGetTool` | HTTP 请求 |

使用方式：

```python
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_community.utilities import SQLDatabase
from langchain_community.tools.sql_database.tool import QuerySQLDataBaseTool

# 搜索工具
search = TavilySearchResults(max_results=3)

# 数据库工具
db = SQLDatabase.from_uri("sqlite:///mydb.sqlite3")
sql_tool = QuerySQLDataBaseTool(db=db)
```

> 古语点睛："善假于物"的更高境界不是自己造物，而是善用已有之物。LangChain 的工具生态正是这种智慧的体现——站在前人肩上，而非从零开始。

- - -

## 8.3 MCP（Model Context Protocol）协议详解

### 8.3.1 为什么需要 MCP？

想象一个场景：你的 Agent 用 LangChain 定义了一套工具，另一位开发者用 LlamaIndex 定义了另一套工具，还有一帮人在用 AutoGPT 的插件格式。工具定义百花齐放，但彼此不通——每换一个框架，工具就得重写一遍。

这就像战国时期的度量衡——各国各制，商旅往来极不方便。MCP 就是要做 Agent 世界的"车同轨、书同文"。

**MCP（Model Context Protocol）** 是由 Anthropic 于2024年底发布的开放协议，它定义了一套标准化的方式，让 AI 模型能够与外部工具、数据源进行交互。核心设计理念：

1. **协议标准化**：所有工具遵循统一的接口规范
2. **传输解耦**：支持 stdio 和 SSE 两种传输方式
3. **能力发现**：客户端可以动态发现服务端提供的能力
4. **双向通信**：不只是模型调工具，工具也可以主动推送信息

### 8.3.2 MCP 架构

MCP 采用经典的客户端-服务端架构：

```
+---------------------+         +---------------------+
|                     |         |                     |
|   MCP Host（宿主）   |         |  MCP Server（服务）  |
|   如：Claude Desktop|         |                     |
|                     |         |  +---------------+  |
|  +---------------+  |  MCP    |  |   Tools       |  |
|  | MCP Client    |◄-┼---------┼-►|   Resources   |  |
|  |               |  | 协议    |  |   Prompts     |  |
|  +---------------+  |         |  +---------------+  |
|                     |         |                     |
+---------------------+         +---------------------+
```

**核心概念**：

- **Host（宿主）**：发起连接的应用程序，如 Claude Desktop、IDE 插件等
- **Client（客户端）**：在 Host 内部，负责与 Server 建立连接和通信
- **Server（服务端）**：提供具体能力的程序，暴露工具、资源、提示词
- **Transport（传输层）**：通信方式，目前支持 stdio（本地进程通信）和 SSE（HTTP 长连接）

MCP Server 暴露三种能力：

| 能力 | 说明 | 示例 |
|------|------|------|
| **Tools** | 可被调用的函数 | 查询数据库、调用 API |
| **Resources** | 可被读取的数据 | 文件内容、数据库记录 |
| **Prompts** | 预设的提示词模板 | 常用任务模板 |

### 8.3.3 开发一个 MCP Server

让我们从零开发一个提供天气查询和城市信息查询的 MCP Server：

```python
# ch08_mcp_server.py
# 版本: v1.0
# MCP Server 示例：天气与城市信息服务

from mcp.server.fastmcp import FastMCP
import json

# 创建 MCP Server 实例
mcp = FastMCP("CityInfoServer")


# ========== 工具（Tools）==========

@mcp.tool()
def get_weather(city: str) -> str:
    """获取指定城市的当前天气信息
    
    Args:
        city: 城市名称，如'北京'、'上海'、'广州'
    """
    weather_data = {
        "北京": {"temperature": 28, "condition": "晴", "humidity": 35, "wind": "北风3级"},
        "上海": {"temperature": 32, "condition": "多云", "humidity": 72, "wind": "东南风2级"},
        "广州": {"temperature": 35, "condition": "雷阵雨", "humidity": 85, "wind": "南风1级"},
        "深圳": {"temperature": 33, "condition": "阵雨", "humidity": 80, "wind": "南风2级"},
        "成都": {"temperature": 26, "condition": "阴", "humidity": 65, "wind": "微风"},
    }
    data = weather_data.get(city)
    if data:
        return json.dumps({"city": city, **data}, ensure_ascii=False)
    return f"暂无{city}的天气数据"


@mcp.tool()
def get_city_info(city: str) -> str:
    """获取城市的基本信息，包括人口、面积、GDP等
    
    Args:
        city: 城市名称
    """
    city_data = {
        "北京": {"population": "2189万", "area": "16410km²", "gdp": "43760亿元", "districts": 16},
        "上海": {"population": "2487万", "area": "6340km²", "gdp": "47218亿元", "districts": 16},
        "广州": {"population": "1881万", "area": "7434km²", "gdp": "30355亿元", "districts": 11},
    }
    data = city_data.get(city)
    if data:
        return json.dumps({"city": city, **data}, ensure_ascii=False)
    return f"暂无{city}的基本信息"


# ========== 资源（Resources）==========

@mcp.resource("city://weather/{city}")
def get_weather_resource(city: str) -> str:
    """以资源形式提供天气数据"""
    return get_weather(city)


@mcp.resource("city://info/{city}")
def get_city_info_resource(city: str) -> str:
    """以资源形式提供城市信息"""
    return get_city_info(city)


# ========== 提示词（Prompts）==========

@mcp.prompt()
def weather_report(city: str) -> str:
    """生成天气播报的提示词模板"""
    return f"""请根据以下天气数据，生成一段专业的天气播报：

城市：{city}
天气数据：{get_weather(city)}

请用通俗易懂的语言播报天气，并给出出行建议。"""


# 启动 Server
if __name__ == "__main__":
    mcp.run()
```

### 8.3.4 开发 MCP Client

Client 负责连接 Server 并调用其提供的能力：

```python
# ch08_mcp_client.py
# 版本: v1.0
# MCP Client 示例

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate
import asyncio


async def run_mcp_agent():
    """通过 MCP Client 连接 Server，并将工具加载到 LangChain Agent"""

    # 配置 MCP Server 连接参数
    server_params = StdioServerParameters(
        command="python",
        args=["ch08_mcp_server.py"],  # 启动我们的 MCP Server
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # 初始化连接
            await session.initialize()

            # 从 MCP Server 加载工具
            tools = await load_mcp_tools(session)
            print(f"已加载 {len(tools)} 个 MCP 工具：")
            for tool in tools:
                print(f"  - {tool.name}: {tool.description}")

            # 将 MCP 工具绑定到 LangChain Agent
            llm = ChatOpenAI(model="claude-opus-4-7", temperature=0, base_url=os.getenv("OPENAI_BASE_URL"))
            prompt = ChatPromptTemplate.from_messages([
                ("system", "你是一个城市信息助手，可以查询天气和城市信息。请用中文回答。"),
                ("human", "{input}"),
                ("placeholder", "{agent_scratchpad}"),
            ])

            agent = create_tool_calling_agent(llm, tools, prompt)
            agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

            # 执行查询
            result = await agent_executor.ainvoke({
                "input": "北京和上海今天天气怎么样？哪个城市更适合出行？"
            })

            print(f"\n最终回答：{result['output']}")


if __name__ == "__main__":
    asyncio.run(run_mcp_agent())
```

### 8.3.5 MCP 的核心价值

MCP 带来的变革可以用三个关键词概括：

1. 一次开发，处处可用：你开发一个 MCP Server，任何支持 MCP 的客户端（Claude Desktop、Cursor、各种 Agent 框架）都能直接使用，无需为每个框架写适配代码

2. 动态发现：Client 不需要预先知道 Server 有哪些工具，连接后通过协议自动发现。这意味着你可以随时给 Server 添加新工具，Client 端无需修改

3. 安全边界：MCP 的 Resource 机制是只读的，Tool 机制是有明确签名的。Server 可以控制暴露哪些能力、限制哪些操作，形成天然的安全边界

> 古语点睛："车同轨，书同文"——秦统一六国后的第一件大事就是统一度量衡，因为标准统一是协作的基础。MCP 在 Agent 世界中扮演的正是这个角色。

- - -

## 8.4 自定义工具开发最佳实践

开发自定义工具不只是"写个函数"那么简单。一个生产级的工具需要考虑：输入校验、错误处理、超时控制、日志记录、可观测性等多个维度。

### 8.4.1 工具设计原则

我们总结为 **SAFE 原则**：

- **S — Simple（简单）**：每个工具只做一件事，职责单一
- **A — Accurate（精确）**：参数定义精确，描述无歧义
- **F — Fault-tolerant（容错）**：优雅处理异常，不因工具错误导致 Agent 崩溃
- **E — Explicit（明确）**：返回结果结构明确，模型容易理解

### 8.4.2 生产级工具模板

以下是一个可供复用的生产级工具模板：

```python
# ch08_tool_template.py
# 版本: v1.0
# 生产级工具开发模板

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, field_validator
from typing import Type, Optional
import logging
import time
import functools

logger = logging.getLogger(__name__)


# ========== 通用装饰器 ==========

def with_timeout(seconds: int = 30):
    """超时控制装饰器"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            import signal

            def timeout_handler(signum, frame):
                raise TimeoutError(f"工具执行超时（{seconds}秒）")

            # 仅在支持 signal 的系统上使用
            try:
                old_handler = signal.signal(signal.SIGALRM, timeout_handler)
                signal.alarm(seconds)
                try:
                    result = func(*args, **kwargs)
                finally:
                    signal.alarm(0)
                    signal.signal(signal.SIGALRM, old_handler)
                return result
            except (OSError, ValueError):
                # Windows 不支持 SIGALRM，直接执行
                return func(*args, **kwargs)

        return wrapper
    return decorator


def with_logging(func):
    """日志记录装饰器"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        tool_name = func.__name__
        logger.info(f"[工具调用] {tool_name} | 参数: {kwargs}")
        start_time = time.time()
        try:
            result = func(*args, **kwargs)
            elapsed = time.time() - start_time
            logger.info(f"[工具完成] {tool_name} | 耗时: {elapsed:.2f}s | 结果长度: {len(str(result))}")
            return result
        except Exception as e:
            elapsed = time.time() - start_time
            logger.error(f"[工具异常] {tool_name} | 耗时: {elapsed:.2f}s | 错误: {e}")
            raise

    return wrapper


def with_retry(max_retries: int = 3, delay: float = 1.0):
    """重试装饰器"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        time.sleep(delay * (attempt + 1))  # 递增延迟
                        logger.warning(f"[重试] {func.__name__} 第{attempt + 1}次重试...")
            raise last_error

        return wrapper
    return decorator


# ========== 生产级工具示例 ==========

class ExchangeRateInput(BaseModel):
    """汇率查询输入参数"""
    from_currency: str = Field(
        description="源货币代码，如CNY、USD、EUR",
        pattern="^[A-Z]{3}$"  # ISO 4217 货币代码格式
    )
    to_currency: str = Field(
        description="目标货币代码",
        pattern="^[A-Z]{3}$"
    )
    amount: float = Field(
        default=1.0,
        description="兑换金额",
        gt=0  # 必须大于0
    )

    @field_validator("from_currency", "to_currency")
    @classmethod
    def validate_currency(cls, v: str) -> str:
        """校验货币代码"""
        valid_currencies = {"CNY", "USD", "EUR", "GBP", "JPY", "KRW", "HKD"}
        if v not in valid_currencies:
            raise ValueError(f"不支持的货币代码: {v}，支持的货币: {valid_currencies}")
        return v


class ExchangeRateTool(BaseTool):
    """汇率查询工具（生产级示例）"""

    name: str = "exchange_rate"
    description: str = "查询实时汇率并计算兑换金额。支持主流货币：CNY、USD、EUR、GBP、JPY、KRW、HKD"
    args_schema: Type[BaseModel] = ExchangeRateInput

    @with_timeout(10)
    @with_logging
    @with_retry(max_retries=2, delay=0.5)
    def _run(self, from_currency: str, to_currency: str, amount: float = 1.0) -> str:
        """同步执行汇率查询"""
        try:
            # 实际项目中这里调用真实汇率 API
            # 此处使用模拟数据
            rates = {
                ("CNY", "USD"): 0.138,
                ("USD", "CNY"): 8.24,
                ("CNY", "EUR"): 0.127,
                ("EUR", "CNY"): 8.87,
                ("CNY", "JPY"): 20.83,
                ("JPY", "CNY"): 0.048,
                ("USD", "EUR"): 0.92,
                ("EUR", "USD"): 1.087,
            }

            rate = rates.get((from_currency, to_currency))
            if rate is None:
                # 尝试通过 USD 中转计算
                rate_to_usd = rates.get((from_currency, "USD"))
                rate_from_usd = rates.get(("USD", to_currency))
                if rate_to_usd and rate_from_usd:
                    rate = rate_to_usd * rate_from_usd
                else:
                    return f"暂不支持 {from_currency} → {to_currency} 的汇率查询"

            converted = amount * rate
            return (
                f"汇率：1 {from_currency} = {rate} {to_currency}\n"
                f"兑换：{amount} {from_currency} = {converted:.2f} {to_currency}"
            )

        except TimeoutError:
            return "汇率查询超时，请稍后重试"
        except Exception as e:
            return f"汇率查询失败：{str(e)}"

    async def _arun(self, from_currency: str, to_currency: str, amount: float = 1.0) -> str:
        """异步执行"""
        return self._run(from_currency, to_currency, amount)


# ========== 演示 ==========

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    tool = ExchangeRateTool()

    # 正常调用
    print(tool._run(from_currency="CNY", to_currency="USD", amount=1000))

    print()

    # 参数校验
    try:
        tool._run(from_currency="XXX", to_currency="USD")
    except Exception as e:
        print(f"参数校验失败：{e}")
```

### 8.4.3 工具组合模式

当单个工具无法满足需求时，我们可以组合多个工具形成覆盖更广的能力。常见的组合模式：

1. 串行链式模式：工具 A 的输出作为工具 B 的输入

```
用户提问 → [查汇率] → [计算金额] → [格式化输出] → 回答
```

2. 并行聚合模式：多个工具同时执行，结果聚合

```
用户提问 → [查天气] --+
         → [查航班] --┤→ [综合分析] → 回答
         → [查酒店] --+
```

3. 条件路由模式：根据中间结果决定调用哪个工具

```
用户提问 → [意图识别] -→ 退货 → [退款工具]
                    ├→ 换货 → [库存查询] → [换货工具]
                    +→ 咨询 → [知识库检索]
```

这些模式不是互斥的——一个复杂的 Agent 工作流中，通常会混合使用多种模式。关键是要把每个工具设计得足够"原子化"，这样组合起来才灵活。

> 古语点睛："工欲善其事，必先利其器"——工具的"利"不只在于单兵作战的能力，更在于组合编排的灵活性。单个工具做好一件事，组合起来就能应对万变。

- - -

## 8.5 工具安全性

给 Agent 接入工具，就像给一个刚学会走路的孩子递了一把钥匙——他可以开门，也可以把自己锁在外面。安全不是可选项，而是必选项。

### 8.5.1 三层防护模型

我们提出工具安全的三层防护模型：

```
+--------------------------------------+
|         第1层：输入校验               |  ← 防御畸形/恶意输入
|  Pydantic 校验 / 正则匹配 / 白名单   |
├--------------------------------------┤
|         第2层：权限控制               |  ← 限制工具可访问的资源
|  RBAC / 能力令牌 / 资源白名单         |
├--------------------------------------┤
|         第3层：沙箱隔离               |  ← 限制工具执行环境
|  Docker / 子进程 / 网络隔离           |
+--------------------------------------+
```

### 8.5.2 输入校验

输入校验是第一道防线。我们用 Pydantic 做结构化校验，结合自定义 validator 做语义校验：

```python
# ch08_tool_security.py
# 版本: v1.0
# 工具安全示例

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
import re
import os


# ===== 输入校验示例 =====

class FileOperationInput(BaseModel):
    """文件操作输入校验"""

    file_path: str = Field(description="文件路径")
    content: Optional[str] = Field(default=None, description="文件内容")

    @field_validator("file_path")
    @classmethod
    def validate_path_security(cls, v: str) -> str:
        """防止路径遍历攻击"""
        # 规范化路径
        normalized = os.path.normpath(v)

        # 检查路径遍历
        if ".." in normalized:
            raise ValueError(f"路径不允许包含 '..'：{v}")

        # 检查绝对路径（限制在允许的目录内）
        allowed_dirs = ["/tmp/agent_workspace", "/data/agent_workspace"]
        if os.path.isabs(normalized):
            if not any(normalized.startswith(d) for d in allowed_dirs):
                raise ValueError(f"路径不在允许的目录内：{v}")

        # 检查敏感文件
        sensitive_patterns = [r"/etc/passwd", r"/etc/shadow", r"\.ssh", r"\.env"]
        for pattern in sensitive_patterns:
            if re.search(pattern, normalized):
                raise ValueError(f"不允许访问敏感路径：{v}")

        return normalized

    @field_validator("content")
    @classmethod
    def validate_content_size(cls, v: Optional[str]) -> Optional[str]:
        """限制内容大小"""
        if v and len(v) > 1_000_000:  # 1MB
            raise ValueError("文件内容超过1MB限制")
        return v


class SQLQueryInput(BaseModel):
    """SQL查询输入校验"""

    query: str = Field(description="SQL查询语句")

    @field_validator("query")
    @classmethod
    def validate_sql_safety(cls, v: str) -> str:
        """防止SQL注入和危险操作"""
        # 转小写检查
        v_lower = v.lower().strip()

        # 只允许SELECT
        if not v_lower.startswith("select"):
            raise ValueError("仅允许SELECT查询，不允许增删改操作")

        # 检查危险关键字
        dangerous_keywords = [
            "drop", "delete", "truncate", "alter",
            "insert", "update", "exec", "execute",
            "xp_", "sp_", "0x", "--", ";"
        ]
        for keyword in dangerous_keywords:
            if keyword in v_lower:
                raise ValueError(f"SQL中包含不允许的关键字：{keyword}")

        return v


# ===== 权限控制示例 =====

class Permission:
    """工具权限定义"""
    READ_FILE = "file:read"
    WRITE_FILE = "file:write"
    QUERY_DB = "db:query"
    CALL_API = "api:call"


class ToolPermissionChecker:
    """工具权限检查器"""

    def __init__(self):
        # 角色-权限映射（RBAC）
        self.role_permissions = {
            "viewer": {Permission.READ_FILE, Permission.QUERY_DB},
            "editor": {Permission.READ_FILE, Permission.WRITE_FILE, Permission.QUERY_DB},
            "admin": {
                Permission.READ_FILE, Permission.WRITE_FILE,
                Permission.QUERY_DB, Permission.CALL_API
            },
        }
        # 工具-所需权限映射
        self.tool_permissions = {
            "read_file": Permission.READ_FILE,
            "write_file": Permission.WRITE_FILE,
            "query_database": Permission.QUERY_DB,
            "call_external_api": Permission.CALL_API,
        }

    def check(self, tool_name: str, role: str) -> bool:
        """检查角色是否有权限使用工具"""
        required = self.tool_permissions.get(tool_name)
        if not required:
            return False
        allowed = self.role_permissions.get(role, set())
        return required in allowed


# ===== 演示 =====

def demo_security():
    """演示安全校验"""

    # 输入校验 - 正常路径
    try:
        inp = FileOperationInput(file_path="/tmp/agent_workspace/data.txt")
        print(f"正常路径校验通过: {inp.file_path}")
    except Exception as e:
        print(f"校验失败: {e}")

    # 输入校验 - 路径遍历攻击
    try:
        inp = FileOperationInput(file_path="/tmp/agent_workspace/../../etc/passwd")
    except Exception as e:
        print(f"路径遍历攻击被拦截: {e}")

    # 输入校验 - 敏感文件
    try:
        inp = FileOperationInput(file_path="/etc/shadow")
    except Exception as e:
        print(f"敏感文件访问被拦截: {e}")

    # SQL校验 - 正常查询
    try:
        inp = SQLQueryInput(query="SELECT name, age FROM users WHERE id = 1")
        print(f"正常SQL校验通过")
    except Exception as e:
        print(f"SQL校验失败: {e}")

    # SQL校验 - 注入攻击
    try:
        inp = SQLQueryInput(query="SELECT * FROM users; DROP TABLE users")
    except Exception as e:
        print(f"SQL注入被拦截: {e}")

    # 权限检查
    checker = ToolPermissionChecker()
    print(f"\nviewer 调用 write_file: {checker.check('write_file', 'viewer')}")
    print(f"editor 调用 write_file: {checker.check('write_file', 'editor')}")
    print(f"viewer 调用 query_database: {checker.check('query_database', 'viewer')}")


if __name__ == "__main__":
    demo_security()
```

### 8.5.3 沙箱隔离

对于代码执行类工具，沙箱隔离是必不可少的。常见方案：

| 方案 | 隔离级别 | 适用场景 | 复杂度 |
|------|----------|----------|--------|
| subprocess + 资源限制 | 进程级 | 简单脚本执行 | 低 |
| Docker 容器 | 系统级 | 完整代码执行环境 | 中 |
| gVisor / Firecracker | 内核级 | 强安全隔离 | 高 |
| WebAssembly (WASM) | 沙箱级 | 轻量级计算 | 中 |

最简单的 subprocess 沙箱示例：

```python
# ch08_sandbox.py
# 版本: v1.0
# 简易沙箱执行器

import subprocess
import tempfile
import os


class CodeSandbox:
    """简易 Python 代码沙箱"""

    def __init__(
        self,
        timeout: int = 10,
        max_output: int = 10000,
        allowed_modules: list = None,
    ):
        self.timeout = timeout
        self.max_output = max_output
        self.allowed_modules = allowed_modules or ["math", "json", "re", "datetime", "collections"]

    def execute(self, code: str) -> dict:
        """在沙箱中执行代码"""

        # 安全检查：不允许导入未授权模块
        for line in code.split("\n"):
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from "):
                for mod in self.allowed_modules:
                    if mod in stripped:
                        break
                else:
                    if "import" in stripped:
                        return {
                            "success": False,
                            "error": f"不允许导入模块: {stripped}，允许的模块: {self.allowed_modules}"
                        }

        # 安全检查：禁止危险操作
        dangerous = ["os.system", "subprocess", "eval(", "exec(", "__import__", "open("]
        for d in dangerous:
            if d in code:
                return {
                    "success": False,
                    "error": f"代码中包含不允许的操作: {d}"
                }

        # 在临时文件中执行
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            # 添加资源限制
            f.write("import resource\n")
            f.write(f"resource.setrlimit(resource.RLIMIT_CPU, ({self.timeout}, {self.timeout}))\n")
            f.write("resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))\n")
            f.write("\n")
            f.write(code)
            temp_path = f.name

        try:
            result = subprocess.run(
                ["python", temp_path],
                capture_output=True,
                text=True,
                timeout=self.timeout + 2,
                cwd="/tmp",  # 在 /tmp 目录执行
            )

            stdout = result.stdout[:self.max_output]
            stderr = result.stderr[:self.max_output]

            return {
                "success": result.returncode == 0,
                "stdout": stdout,
                "stderr": stderr,
                "returncode": result.returncode,
            }

        except subprocess.TimeoutExpired:
            return {"success": False, "error": f"代码执行超时（{self.timeout}秒）"}
        except Exception as e:
            return {"success": False, "error": str(e)}
        finally:
            os.unlink(temp_path)


if __name__ == "__main__":
    sandbox = CodeSandbox(timeout=5)

    # 正常执行
    result = sandbox.execute("import math\nprint(math.sqrt(144))")
    print(f"正常执行: {result}")

    # 尝试危险操作
    result = sandbox.execute("import os\nos.system('ls /')")
    print(f"危险操作: {result}")

    # 超时
    result = sandbox.execute("while True: pass")
    print(f"超时执行: {result}")
```

> 古语点睛："君子不立危墙之下"——给 Agent 接工具不是放权，而是设防。三层防护模型的核心思想是：永远不要假设输入是安全的，永远不要给工具超过必要的权限，永远假设执行环境可能被突破。

- - -

## 8.6 实战

为 Agent 接入三种最常见的工具：数据库查询、API 调用、文件系统操作。每个工具都遵循上一节的生产级标准，完整可运行。

### 8.6.1 数据库查询工具

```python
# ch08_tool_database.py
# 版本: v1.0
# 数据库查询工具

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, field_validator
from typing import Type
import sqlite3
import json
import logging

logger = logging.getLogger(__name__)


class DatabaseQueryInput(BaseModel):
    """数据库查询输入"""
    query: str = Field(description="SQL查询语句（仅支持SELECT）")
    database: str = Field(
        default="ecommerce",
        description="数据库名称",
        pattern="^[a-zA-Z_][a-zA-Z0-9_]*$"  # 只允许合法数据库名
    )

    @field_validator("query")
    @classmethod
    def validate_query(cls, v: str) -> str:
        v_lower = v.lower().strip()
        if not v_lower.startswith("select"):
            raise ValueError("仅允许SELECT查询")
        dangerous = ["drop", "delete", "truncate", "alter", "insert", "update", ";"]
        for kw in dangerous:
            if kw in v_lower:
                raise ValueError(f"SQL包含不允许的关键字：{kw}")
        return v


class DatabaseTool(BaseTool):
    """数据库查询工具"""

    name: str = "query_database"
    description: str = (
        "查询电商数据库，支持以下表：\n"
        "- products(商品表): id, name, category, price, stock, rating\n"
        "- orders(订单表): id, product_id, quantity, total_price, status, created_at\n"
        "- customers(客户表): id, name, email, city, total_spent\n"
        "仅支持SELECT查询，返回JSON格式结果。"
    )
    args_schema: Type[BaseModel] = DatabaseQueryInput

    # 数据库路径映射
    db_paths: dict = {
        "ecommerce": "/tmp/agent_ecommerce.db",
    }

    def _init_db(self, db_name: str):
        """初始化示例数据库"""
        db_path = self.db_paths.get(db_name, f"/tmp/agent_{db_name}.db")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # 创建示例表
        cursor.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                price REAL,
                stock INTEGER,
                rating REAL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                product_id INTEGER,
                quantity INTEGER,
                total_price REAL,
                status TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY,
                name TEXT,
                email TEXT,
                city TEXT,
                total_spent REAL
            );

            INSERT OR IGNORE INTO products VALUES
                (1, 'iPhone 16', '手机', 7999, 120, 4.8),
                (2, 'MacBook Pro', '电脑', 14999, 45, 4.9),
                (3, 'AirPods Pro', '配件', 1899, 300, 4.7),
                (4, 'iPad Air', '平板', 4799, 80, 4.6),
                (5, 'Apple Watch', '配件', 2999, 200, 4.5);

            INSERT OR IGNORE INTO orders VALUES
                (1, 1, 2, 15998, '已完成', '2026-05-20'),
                (2, 2, 1, 14999, '已发货', '2026-05-21'),
                (3, 3, 5, 9495, '处理中', '2026-05-22'),
                (4, 1, 1, 7999, '已完成', '2026-05-18'),
                (5, 4, 2, 9598, '已发货', '2026-05-19');

            INSERT OR IGNORE INTO customers VALUES
                (1, '张三', 'zhangsan@email.com', '北京', 23997),
                (2, '李四', 'lisi@email.com', '上海', 14999),
                (3, '王五', 'wangwu@email.com', '广州', 9495),
                (4, '赵六', 'zhaoliu@email.com', '深圳', 7999);
        """)

        conn.commit()
        conn.close()
        return db_path

    def _run(self, query: str, database: str = "ecommerce") -> str:
        try:
            db_path = self._init_db(database)
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row  # 以字典形式返回
            cursor = conn.cursor()

            cursor.execute(query)
            rows = cursor.fetchall()

            # 转为字典列表
            results = [dict(row) for row in rows]

            conn.close()

            if not results:
                return "查询结果为空"

            return json.dumps(results, ensure_ascii=False, default=str)

        except Exception as e:
            logger.error(f"数据库查询失败: {e}")
            return f"查询失败: {str(e)}"

    async def _arun(self, query: str, database: str = "ecommerce") -> str:
        return self._run(query, database)


if __name__ == "__main__":
    tool = DatabaseTool()

    # 查询所有商品
    print("=== 商品列表 ===")
    print(tool._run("SELECT name, price, stock, rating FROM products ORDER BY rating DESC"))

    # 查询订单统计
    print("\n=== 订单统计 ===")
    print(tool._run("SELECT status, COUNT(*) as count, SUM(total_price) as total FROM orders GROUP BY status"))
```

### 8.6.2 API 调用工具

```python
# ch08_tool_api.py
# 版本: v1.0
# API调用工具

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field
from typing import Type, Optional
import json
import logging
import time
from urllib.parse import quote

logger = logging.getLogger(__name__)


class APICallInput(BaseModel):
    """API调用输入"""
    endpoint: str = Field(
        description="API端点名称，可选：weather(天气)、news(新闻)、translate(翻译)、geocode(地理编码)"
    )
    params: str = Field(
        description="请求参数，JSON格式字符串"
    )


class APICallTool(BaseTool):
    """API调用工具（模拟）"""

    name: str = "call_api"
    description: str = (
        "调用外部API获取信息。支持以下端点：\n"
        "- weather: 天气查询，参数 {\"city\": \"城市名\"}\n"
        "- news: 新闻查询，参数 {\"keyword\": \"关键词\", \"limit\": 数量}\n"
        "- translate: 翻译，参数 {\"text\": \"文本\", \"target_lang\": \"目标语言\"}\n"
        "- geocode: 地理编码，参数 {\"address\": \"地址\"}"
    )
    args_schema: Type[BaseModel] = APICallInput

    # 允许的端点白名单
    ALLOWED_ENDPOINTS = {"weather", "news", "translate", "geocode"}

    # 模拟数据
    MOCK_DATA = {
        "weather": {
            "北京": {"temp": 28, "condition": "晴", "humidity": 35, "wind": "北风3级"},
            "上海": {"temp": 32, "condition": "多云", "humidity": 72, "wind": "东南风2级"},
            "深圳": {"temp": 33, "condition": "阵雨", "humidity": 80, "wind": "南风2级"},
        },
        "news": {
            "AI": [
                {"title": "GPT-5发布：多模态能力再次突破", "source": "科技日报", "date": "2026-05-22"},
                {"title": "AI Agent在企业级应用中迎来爆发", "source": "经济观察报", "date": "2026-05-21"},
                {"title": "自动驾驶L4级别获准上路测试", "source": "新华网", "date": "2026-05-20"},
            ],
            "科技": [
                {"title": "量子计算新突破：1000量子比特芯片问世", "source": "科技日报", "date": "2026-05-22"},
                {"title": "国产大飞机C919交付量突破百架", "source": "人民日报", "date": "2026-05-21"},
            ],
        },
        "geocode": {
            "天安门": {"lat": 39.9087, "lng": 116.3975, "province": "北京", "city": "北京"},
            "东方明珠": {"lat": 31.2397, "lng": 121.4998, "province": "上海", "city": "上海"},
        },
    }

    def _run(self, endpoint: str, params: str) -> str:
        start_time = time.time()

        # 端点白名单检查
        if endpoint not in self.ALLOWED_ENDPOINTS:
            return f"不支持的API端点: {endpoint}，支持的端点: {self.ALLOWED_ENDPOINTS}"

        try:
            params_dict = json.loads(params)
        except json.JSONDecodeError:
            return f"参数格式错误，请提供有效的JSON字符串"

        try:
            result = self._call_endpoint(endpoint, params_dict)
            elapsed = time.time() - start_time
            logger.info(f"[API] {endpoint} | 耗时: {elapsed:.2f}s")
            return json.dumps(result, ensure_ascii=False)

        except Exception as e:
            logger.error(f"[API] {endpoint} 调用失败: {e}")
            return f"API调用失败: {str(e)}"

    def _call_endpoint(self, endpoint: str, params: dict) -> dict:
        """调用具体端点（模拟）"""

        if endpoint == "weather":
            city = params.get("city", "")
            data = self.MOCK_DATA["weather"].get(city)
            if data:
                return {"city": city, **data, "source": "weather_api"}
            return {"error": f"未找到{city}的天气数据"}

        elif endpoint == "news":
            keyword = params.get("keyword", "")
            limit = params.get("limit", 3)
            articles = self.MOCK_DATA["news"].get(keyword, [])
            if not articles:
                # 模糊搜索
                for k, v in self.MOCK_DATA["news"].items():
                    if keyword in k or k in keyword:
                        articles = v
                        break
            return {"keyword": keyword, "total": len(articles), "articles": articles[:limit]}

        elif endpoint == "translate":
            text = params.get("text", "")
            target_lang = params.get("target_lang", "en")
            # 模拟翻译（实际项目调用翻译API）
            return {
                "original": text,
                "translated": f"[翻译结果: {text} → {target_lang}]",
                "source_lang": "auto",
                "target_lang": target_lang,
            }

        elif endpoint == "geocode":
            address = params.get("address", "")
            data = self.MOCK_DATA["geocode"].get(address)
            if data:
                return {"address": address, **data}
            return {"error": f"未找到地址: {address}"}

        return {"error": f"未知端点: {endpoint}"}

    async def _arun(self, endpoint: str, params: str) -> str:
        return self._run(endpoint, params)


if __name__ == "__main__":
    tool = APICallTool()

    # 天气查询
    print("=== 天气查询 ===")
    print(tool._run("weather", '{"city": "北京"}'))

    # 新闻查询
    print("\n=== 新闻查询 ===")
    print(tool._run("news", '{"keyword": "AI", "limit": 2}'))

    # 翻译
    print("\n=== 翻译 ===")
    print(tool._run("translate", '{"text": "你好世界", "target_lang": "en"}'))

    # 地理编码
    print("\n=== 地理编码 ===")
    print(tool._run("geocode", '{"address": "天安门"}'))

    # 不允许的端点
    print("\n=== 非法端点 ===")
    print(tool._run("hack", '{"cmd": "rm -rf /"}'))
```

### 8.6.3 文件系统工具

```python
# ch08_tool_filesystem.py
# 版本: v1.0
# 文件系统操作工具

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, field_validator
from typing import Type, Optional, List
import os
import json
import logging

logger = logging.getLogger(__name__)

# 允许的工作目录
WORKSPACE_ROOT = "/tmp/agent_workspace"
os.makedirs(WORKSPACE_ROOT, exist_ok=True)


class FileReadInput(BaseModel):
    """文件读取输入"""
    file_path: str = Field(description="文件路径（相对于工作目录）")

    @field_validator("file_path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        normalized = os.path.normpath(v)
        if ".." in normalized:
            raise ValueError("路径不允许包含 '..'")
        if normalized.startswith("/"):
            raise ValueError("请使用相对路径")
        return normalized


class FileWriteInput(BaseModel):
    """文件写入输入"""
    file_path: str = Field(description="文件路径（相对于工作目录）")
    content: str = Field(description="文件内容")

    @field_validator("file_path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        normalized = os.path.normpath(v)
        if ".." in normalized:
            raise ValueError("路径不允许包含 '..'")
        if normalized.startswith("/"):
            raise ValueError("请使用相对路径")
        return normalized

    @field_validator("content")
    @classmethod
    def validate_content_size(cls, v: str) -> str:
        if len(v) > 1_000_000:
            raise ValueError("文件内容超过1MB限制")
        return v


class ListDirInput(BaseModel):
    """目录列表输入"""
    dir_path: str = Field(default=".", description="目录路径（相对于工作目录）")

    @field_validator("dir_path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        normalized = os.path.normpath(v)
        if ".." in normalized:
            raise ValueError("路径不允许包含 '..'")
        return normalized


class FileReadTool(BaseTool):
    """文件读取工具"""

    name: str = "read_file"
    description: str = "读取工作目录中的文件内容。file_path为相对于工作目录的路径。"
    args_schema: Type[BaseModel] = FileReadInput

    def _run(self, file_path: str) -> str:
        full_path = os.path.join(WORKSPACE_ROOT, file_path)
        if not os.path.exists(full_path):
            return f"文件不存在: {file_path}"
        if not os.path.isfile(full_path):
            return f"路径不是文件: {file_path}"
        try:
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read(100_000)  # 最多读取100KB
            return content
        except Exception as e:
            return f"读取文件失败: {str(e)}"

    async def _arun(self, file_path: str) -> str:
        return self._run(file_path)


class FileWriteTool(BaseTool):
    """文件写入工具"""

    name: str = "write_file"
    description: str = "向工作目录写入文件。file_path为相对路径，content为文件内容。"
    args_schema: Type[BaseModel] = FileWriteInput

    def _run(self, file_path: str, content: str) -> str:
        full_path = os.path.join(WORKSPACE_ROOT, file_path)
        # 确保目录存在
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        try:
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"文件写入成功: {file_path} ({len(content)} 字符)"
        except Exception as e:
            return f"写入文件失败: {str(e)}"

    async def _arun(self, file_path: str, content: str) -> str:
        return self._run(file_path, content)


class ListDirTool(BaseTool):
    """目录列表工具"""

    name: str = "list_directory"
    description: str = "列出工作目录中指定路径下的文件和子目录。"
    args_schema: Type[BaseModel] = ListDirInput

    def _run(self, dir_path: str = ".") -> str:
        full_path = os.path.join(WORKSPACE_ROOT, dir_path)
        if not os.path.exists(full_path):
            return f"目录不存在: {dir_path}"
        if not os.path.isdir(full_path):
            return f"路径不是目录: {dir_path}"
        try:
            entries = []
            for entry in os.listdir(full_path):
                entry_path = os.path.join(full_path, entry)
                if os.path.isdir(entry_path):
                    entries.append(f"[DIR]  {entry}")
                else:
                    size = os.path.getsize(entry_path)
                    entries.append(f"[FILE] {entry} ({size} bytes)")
            if not entries:
                return "目录为空"
            return "\n".join(entries)
        except Exception as e:
            return f"列出目录失败: {str(e)}"

    async def _arun(self, dir_path: str = ".") -> str:
        return self._run(dir_path)


if __name__ == "__main__":
    # 测试文件系统工具
    write_tool = FileWriteTool()
    read_tool = FileReadTool()
    list_tool = ListDirTool()

    # 写入文件
    print("=== 写入文件 ===")
    print(write_tool._run("reports/daily.txt", "2026-05-22 销售报告\n总销售额: ¥52,345\n订单数: 128"))

    print(write_tool._run("data/config.json", json.dumps({
        "app_name": "AI Agent Demo",
        "version": "1.0.0",
        "debug": False
    }, ensure_ascii=False, indent=2)))

    # 列出目录
    print("\n=== 目录列表 ===")
    print(list_tool._run("."))

    # 读取文件
    print("\n=== 读取文件 ===")
    print(read_tool._run("reports/daily.txt"))
```

### 8.6.4 组合使用：完整的 Agent 实战

现在把三个工具整合到一个 Agent 中，实现一个真正的"全能助手"：

```python
# ch08_full_agent.py
# 版本: v1.0
# 完整 Agent 实战

import os
import sys
import json
import logging

# 将当前目录加入路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate

# 导入自定义工具
from ch08_tool_database import DatabaseTool
from ch08_tool_api import APICallTool
from ch08_tool_filesystem import FileReadTool, FileWriteTool, ListDirTool

logging.basicConfig(level=logging.INFO)


def create_agent():
    """创建集成所有工具的 Agent"""

    llm = ChatOpenAI(model="claude-opus-4-7", temperature=0, base_url=os.getenv("OPENAI_BASE_URL"))

    # 收集所有工具
    tools = [
        DatabaseTool(),
        APICallTool(),
        FileReadTool(),
        FileWriteTool(),
        ListDirTool(),
    ]

    print("已加载工具：")
    for tool in tools:
        print(f"  - {tool.name}: {tool.description[:50]}...")

    # 创建提示模板
    prompt = ChatPromptTemplate.from_messages([
        ("system", """你是一个全能商务助手，可以帮助用户：
1. 查询电商数据库（商品、订单、客户信息）
2. 调用外部API（天气、新闻、翻译、地理编码）
3. 读写文件系统中的文件

重要规则：
- 数据库查询只支持SELECT语句
- API调用时参数必须是有效的JSON字符串
- 文件操作仅限工作目录内
- 综合多个工具的结果给出完整回答
- 用中文回答"""),
        ("placeholder", "{chat_history}"),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    agent = create_tool_calling_agent(llm, tools, prompt)
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        max_iterations=8,
        handle_parsing_errors=True,
    )

    return agent_executor


def main():
    """主函数：交互式对话"""
    agent = create_agent()

    print("\n" + "=" * 60)
    print("全能商务助手已就绪！输入问题开始对话，输入 'quit' 退出")
    print("=" * 60 + "\n")

    # 示例查询
    demo_queries = [
        "查询销量最好的3个商品，然后查一下北京今天的天气",
        "查一下今天的AI新闻，然后把结果保存到文件里",
        "帮我查一下张三的消费记录，并生成一份客户报告保存到文件",
    ]

    for query in demo_queries:
        print(f"\n{'='*40}")
        print(f"用户: {query}")
        print(f"{'='*40}")
        result = agent.invoke({"input": query})
        print(f"\n助手: {result['output']}\n")


if __name__ == "__main__":
    main()
```

运行这个完整 Agent，你会发现它能自主完成以下复杂任务链：

1. 用户问"查询销量最好的3个商品，然后查一下北京今天的天气" → Agent 先调用数据库工具查商品，再调用 API 工具查天气，综合回答
2. 用户问"查一下今天的AI新闻，然后把结果保存到文件里" → Agent 先调用 API 查新闻，再调用文件系统工具保存结果
3. 用户问"帮我查一下张三的消费记录" → Agent 先调用数据库查客户和订单，生成报告并保存

> 古语点睛："善假于物"的至高境界，不是手握万千工具而眼花缭乱，而是游刃有余地编排组合，让每一把工具在最恰当的时机出手，如行云流水，一气呵成。

- - -

## 进阶拓展

### 工具的"幻觉调用"问题

模型有时候会"编造"工具调用——调用一个不存在的工具名，或者传入不符合参数定义的值。这被称为**工具幻觉（Tool Hallucination）**。应对策略：

1. **严格校验**：在执行前验证工具名和参数格式
2. **优雅降级**：当工具调用失败时，返回明确的错误信息让模型自我修正
3. **Few-shot 示例**：在系统提示中提供正确的工具调用示例

### 工具调用的性能优化

1. **缓存**：对于幂等的工具调用（如查询类），可以引入结果缓存
2. **批量化**：多个同类工具调用合并为一次批量请求
3. **流式返回**：长时间运行的工具可以流式返回中间结果

### MCP 生态展望

MCP 协议仍在快速发展中。未来的方向包括：

- **更多传输方式**：WebSocket、gRPC 等
- **工具市场**：类似插件市场的 MCP Server 分发平台
- **跨 Agent 工具共享**：多个 Agent 实例共享同一个 MCP Server
- **安全增强**：内置认证、审计、限流机制

- - -

## 进阶必做

1. **实现一个支持工具选择的智能路由器**：开发一个工具路由组件，能根据用户问题自动从大量工具中筛选出最相关的 3-5 个工具，再将精简后的工具列表传给模型。对比精简前后的工具选择准确率和响应时间。

2. **开发一个 MCP Server 并接入 Claude Desktop**：参考 8.3 节的示例，开发一个提供你常用功能（如本地文档检索、代码片段查询）的 MCP Server，配置到 Claude Desktop 中验证可用性。

3. **为代码执行工具设计多层沙箱**：在 8.5 节的简易沙箱基础上，增加网络隔离（禁止网络访问）、文件系统隔离（只读挂载）、内存限制，并用一组攻击性测试用例验证沙箱的安全性。

## 参考文献

1. OpenAI. "Function Calling Guide." https://platform.openai.com/docs/guides/function-calling
2. Anthropic. "Model Context Protocol (MCP) Specification." 2024. https://spec.modelcontextprotocol.io/
3. Patil, S. et al. "Gorilla: Large Language Model Connected with Massive APIs." arXiv:2305.15334

## 开放讨论

1. **工具越多越好吗？** 当 Agent 拥有几十甚至上百个工具时，模型的工具选择准确率会下降。你认为应该如何平衡工具数量与选择精度？有没有自动裁剪工具集的方案？

2. **MCP 会成为 Agent 工具的统一标准吗？** MCP 由 Anthropic 于 2024 年底提出，目前 Google 等厂商已跟进支持。随着 A2A 等竞争协议的出现，工具交互标准的格局仍在演变中。Agent 开发者该如何在多协议生态中做出选择？

3. **工具安全与便利性的矛盾**：沙箱和权限控制越严格，工具的能力就越受限。在实际项目中，你如何找到安全与便利的平衡点？

- - -
