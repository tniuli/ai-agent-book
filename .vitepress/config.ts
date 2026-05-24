import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/ai-agent-book/',
  title: 'AI Agent 开发：从原理到生产',
  description: '面向开发者的系统实践指南',
  lang: 'zh-CN',
  
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#3eaf7c' }]
  ],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '开始阅读', link: '/chapters/00-preface' },
      {
        text: 'GitHub',
        link: 'https://github.com/tniuli/ai-agent-book'
      }
    ],

    sidebar: [
      {
        text: '📖 前言',
        items: [
          { text: '本书简介', link: '/chapters/00-preface' }
        ]
      },
      {
        text: '第一篇 原理篇',
        collapsed: false,
        items: [
          { text: '第1章 AI Agent 的本质', link: '/chapters/01-overview' },
          { text: '第2章 Agent 核心架构', link: '/chapters/02-core-architecture' },
          { text: '第3章 技术生态：框架与模型', link: '/chapters/03-ecosystem-frameworks' },
          { text: '第4章 技术生态：工具链与基础设施', link: '/chapters/04-ecosystem-tools' }
        ]
      },
      {
        text: '第二篇 开发篇',
        collapsed: false,
        items: [
          { text: '第5章 从零构建最小 Agent', link: '/chapters/05-minimal-agent' },
          { text: '第6章 LangChain 基础', link: '/chapters/06-langchain-basics' },
          { text: '第7章 LangGraph 深度实战', link: '/chapters/07-langgraph-deep-dive' },
          { text: '第8章 工具调用', link: '/chapters/08-tool-calling' },
          { text: '第9章 记忆系统', link: '/chapters/09-memory-system' }
        ]
      },
      {
        text: '第三篇 增强篇',
        collapsed: false,
        items: [
          { text: '第10章 规划与推理', link: '/chapters/10-planning-reasoning' },
          { text: '第11章 RAG 与知识增强', link: '/chapters/11-rag-knowledge' },
          { text: '第12章 多智能体协作', link: '/chapters/12-multi-agent' },
          { text: '第13章 人机协作模式', link: '/chapters/13-human-in-the-loop' }
        ]
      },
      {
        text: '第四篇 生产篇',
        collapsed: false,
        items: [
          { text: '第14章 评估与测试', link: '/chapters/14-evaluation' },
          { text: '第15章 安全与对齐', link: '/chapters/15-security-alignment' },
          { text: '第16章 部署与运维', link: '/chapters/16-deployment' },
          { text: '第17章 调试技巧', link: '/chapters/17-debugging' }
        ]
      },
      {
        text: '第五篇 前沿篇',
        collapsed: false,
        items: [
          { text: '第18章 行业案例', link: '/chapters/18-industry-cases' },
          { text: '第19章 商业模式', link: '/chapters/19-business-model' },
          { text: '第20章 未来趋势', link: '/chapters/20-future-trends' },
          { text: '第21章 学习路线图', link: '/chapters/21-learning-roadmap' }
        ]
      },
      {
        text: '附录',
        items: [
          { text: '术语表', link: '/glossary' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/tniuli/ai-agent-book' }
    ],

    footer: {
      message: '© 2026 汉清. All rights reserved.'
    },

    editLink: {
      pattern: 'https://github.com/tniuli/ai-agent-book/edit/main/books/ai-agent/chapters/:path',
      text: '在 GitHub 上编辑此页'
    },

    lastUpdated: {
      text: '最后更新于'
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    outline: {
      label: '页面导航',
      level: [2, 3]
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  }
})
