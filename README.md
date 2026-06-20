# TinyGlob

在 3D 地球上点一个地点、选一个时间,和当地那段历史的"亲历者"对话。

Web 应用:Next.js 14 (App Router) + react-globe.gl + Three.js,后端用 LLM + Wikipedia 做事实 grounding,Prisma + PostgreSQL 存账号与"朋友"(保存的角色)。

## 功能

- **3D 地球**:点任意坐标选地点;缩放时逐层显出城市标签(Natural Earth 数据集，现代)做方位参照。
- **历史查阅**:选年/月 → 后端 ReAct agent 拉 Wikipedia 事件 → 流式返回地点简介 + 角色卡。
- **角色扮演**:LLM 扮演该地该年的一个虚构居民跟你对话;敏感事件(战争/灾难)默认走"旁观者"视角,可切"讲解员"。
- **账号 + 朋友**:邮箱注册登录后可把当前角色存为"朋友"(每人上限 3 位),下次直接从朋友继续聊,地球自动飞回该地。

## 快速开始

需要:Node 18+、PostgreSQL(本地或 Docker)。

```bash
# 1. 装依赖
npm install

# 2. 配置环境
cp .env.example .env
# 编辑 .env 填入 DATABASE_URL / AUTH_SECRET / LLM_API_KEY / LLM_MODEL

# 3. 起 PG(可选,Docker 一行)
docker run --name tinyglob-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tinyglob -p 5432:5432 -d postgres:16

# 4. 建表
npx prisma migrate dev

# 5. 跑
npm run dev
```

打开 http://localhost:3000。

## 配置

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `AUTH_SECRET` | 是 | JWT 签名密钥,`openssl rand -hex 32` |
| `LLM_API_KEY` | 是 | LLM 服务商 API key |
| `LLM_BASE_URL` | 否 | OpenAI 兼容端点,留空走 OpenAI 官方 |
| `LLM_MODEL` | 是 | 模型名,如 `gpt-4o-mini` |

任意 OpenAI 兼容服务都行(OpenAI / DeepSeek / 智谱 GLM / OpenRouter / 本地 Ollama)。

## 目录

```
app/           Next.js App Router(页面 + API routes)
  api/
    research/  流式:地点 → Wikipedia grounding → NPC 角色卡
    chat/      角色对话(流式)
    chat-mode/ 角色模式 / 旁观者 / 讲解员切换
    friends/   朋友 CRUD + resume
    auth/      注册 / 登录 / 登出 / me
    geocode/   坐标 → 地名
components/    React 组件(GlobeCanvas / NpcPanel / FriendsPanel ...)
lib/           LLM client、Prisma 单例、auth、ReAct agent、prompts、sensitivity 过滤
prisma/        schema + migrations
public/        cities.json(Natural Earth top 4000 城市标签)
```

## 技术栈

- Next.js 14 · React 18 · TypeScript(strict)
- react-globe.gl · three.js(地球渲染)
- Prisma 6 · PostgreSQL 16
- bcryptjs + jose(自研轻量 cookie session,非 NextAuth)
- OpenAI SDK(对任意 OpenAI 兼容后端)
