# 寻流 SeekFlow

寻流 SeekFlow 是一个免注册、免 API Key 的多源信息检索网页。用户只需输入一次关键词，寻流就会并行查询中文维基百科、GitHub 仓库、OpenAlex 学术成果和 Hacker News，再将不同来源的结果整理成统一卡片。

项目使用原生 HTML、CSS 和 JavaScript，没有第三方前端依赖，也没有自建后端。

在线使用：<https://rongtaocheng32-ctrl.github.io/seekflow-search/>

## 项目解决什么问题

查资料时，百科背景、开源代码、学术证据和开发者讨论通常分散在多个网站。用户需要重复输入关键词、切换页面，还很难保存有价值的线索。

寻流将这个过程合并为一次搜索：

- 一个入口查询四种不同类型的公开信息；
- 统一标题、摘要、元数据和原始链接的展示格式；
- 在浏览器中保存搜索历史和收藏；
- 将单条结果复制为 Markdown，或将全部收藏导出为 JSON。

## 主要功能

- **多源并行检索**：可自由勾选中文维基百科、GitHub、OpenAlex 和 Hacker News，至少选择一个来源即可检索。
- **统一结果卡片**：将标题、摘要、来源、时间、Star、引用量等信息归一化展示。
- **来源筛选**：检索完成后可切换“全部”或某一个特定来源。
- **独立进度和错误状态**：每个数据源都会显示待命、检索中、结果数或失败状态；单个来源失败不影响其他结果。
- **收藏**：在结果卡片中点击星标即可收藏，收藏会保存在 `localStorage`。
- **本地历史**：保留最近 10 组关键词与数据源选择，点击历史可重新检索。
- **Markdown 复制**：单条结果可复制为包含标题、链接、摘要和来源的 Markdown。
- **JSON 导出**：一键下载全部收藏，文件名中包含导出日期。
- **数据清理**：可分别清空历史、收藏，或一次清空全部本地数据。
- **安全渲染**：外部 API 返回的文本通过 DOM `textContent` 写入页面，外链仅允许 HTTP/HTTPS 协议。
- **响应式界面**：适配桌面端、平板和手机，并尊重系统的“减少动效”设置。

## 安装方法

寻流是静态网页，不需要 `npm install`、数据库或 API Key。

### 方法一：使用 Python 启动本地服务器（推荐）

```bash
git clone https://github.com/rongtaocheng32-ctrl/seekflow-search.git
cd seekflow-search
python3 -m http.server 8080
```

在浏览器打开：

```text
http://127.0.0.1:8080
```

### 方法二：直接打开

可直接双击 `index.html`。但部分浏览器会对 `file://` 页面的剪贴板或跨域请求施加额外限制，因此更推荐本地 HTTP 服务器。

## 使用方法

1. 在搜索框输入中文或英文关键词。
2. 勾选需要查询的数据源；默认全选四个来源。
3. 点击“开始寻找”。页面会并行请求所有已选来源。
4. 使用结果上方的筛选按钮，只查看某一来源。
5. 在单条结果中：
   - 点击 `⎘` 复制 Markdown；
   - 点击 `☆` 收藏或点击 `★` 取消收藏；
   - 点击标题打开第三方原始页面。
6. 在右侧信息架重用历史搜索、移除收藏或导出 JSON。

## 输入输出示例

### 输入

```text
关键词：开源 AI 视频剪辑
数据源：中文维基百科、GitHub、OpenAlex、Hacker News
```

### 页面输出

页面会显示一组统一卡片，每张卡片包含：

```text
来源：GitHub
标题：owner/example-video-editor
摘要：仓库的公开项目描述
元数据：TypeScript · 128 stars · 更新 2026年10月8日
原始链接：https://github.com/owner/example-video-editor
```

> 上例只用于说明输出结构。真实结果由检索时的第三方 API 响应决定。

### 复制为 Markdown 的输出

```markdown
- [owner/example-video-editor](https://github.com/owner/example-video-editor)
  仓库的公开项目描述
  来源：GitHub
```

### 收藏 JSON 输出

```json
{
  "app": "寻流 SeekFlow",
  "exportedAt": "2026-10-08T08:00:00.000Z",
  "count": 1,
  "items": [
    {
      "id": "github:123456",
      "source": "github",
      "title": "owner/example-video-editor",
      "summary": "仓库的公开项目描述。",
      "url": "https://github.com/owner/example-video-editor",
      "meta": ["TypeScript", "128 stars", "更新 2026年10月8日"],
      "savedAt": "2026-10-08T08:00:00.000Z"
    }
  ]
}
```

## 数据源

| 数据源 | 公开接口 | 寻流展示的主要信息 |
| --- | --- | --- |
| 中文维基百科 | MediaWiki Action API | 词条标题、导语摘要、原文链接 |
| GitHub | Repository Search REST API | 仓库名、描述、主要语言、Star、更新日期 |
| OpenAlex | Works API | 成果标题、作者、收录来源、发表年份、被引量 |
| Hacker News | Algolia Search API | 讨论标题、发布者、赞同、评论数、发布日期 |

## 本地数据与隐私

寻流仅在 `localStorage` 中保存两类数据：

- `seekflow.history.v1`：最近 10 次搜索的关键词、已选来源和时间；
- `seekflow.favorites.v1`：用户收藏的结果快照。

项目不使用 Cookie、分析脚本或自建后端。但检索时，关键词必须发送给用户勾选的第三方公开 API；各数据源有自己的隐私政策和访问日志。

## 数据源限制

- 第三方 API 需要可用的互联网连接，寻流本身不缓存搜索结果。
- GitHub 匿名仓库搜索有频率限制，短时间重复检索可能返回 `403`。页面会将 GitHub 标记为失败，其他来源仍可继续展示。
- 数据源的 CORS 政策、字段或可用性可能随时变化。
- OpenAlex 部分成果没有公开摘要，页面会用作者和收录来源作为说明。
- Hacker News 结果主要为英文；GitHub 与 OpenAlex 对英文关键词的覆盖通常更完整。
- 检索结果仅为信息线索，寻流不验证第三方内容的准确性，采信前应打开原始页面核对。

## 项目结构

```text
seekflow-search/
├── index.html    # 页面结构和无障碍语义
├── styles.css    # 响应式样式与动效
├── app.js        # 数据源请求、结果渲染和本地存储
├── favicon.svg   # 原创站点图标
├── README.md
├── LICENSE
└── .gitignore
```

## 浏览器兼容性

建议使用近期版本的 Chrome、Edge、Firefox 或 Safari。项目使用 `fetch`、`AbortController`、`URLSearchParams`、`localStorage` 和 CSS `:has()`。

## 许可证

本项目使用 [MIT License](LICENSE)。
