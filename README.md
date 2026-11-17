# 🌸 Gemini 星星猫娘 · Antigravity 界面内嵌桌宠插件

> 专为 **Google Antigravity** 量身打造的高帧率、高互动、具备真实任务与额度感知的界面内嵌桌宠挂件！  
> 拥有 10 款 60fps 细腻动作、双缓冲 0 黑屏/0 重影切帧引擎、原生 React Fiber 额度看板、后台多任务切入感知与 QQ 弹弹果冻拖拽物理。

---

## ✨ 核心特性

- 🐾 **真正界面内嵌 (In-App Overlay)**：
  - 像 IDE 原生组件一样常驻在 Antigravity 窗口右下角，随窗口自适应贴合，不遮挡桌面其他窗口；
  - 具备 **QQ 弹弹果冻拖拽** 与 **视口防出界碰撞**，支持鼠标滚轮在 40% ~ 250% 范围内无级平滑缩放并记忆保存。
- 🎬 **10 款原版 60fps 透明 WebM 细腻动作**：
  - **5 大核心姿态**：
    - 🌸 **待机 (idle)**：自然呼吸与灵动眨眼；
    - 💻 **敲码 (coding)**：全息键盘双爪交替敲击、字符飞溅与桌面微震；
    - 💭 **思考 (thinking)**：托腮沉思构思方案；
    - 🎉 **庆祝 (celebrate)**：全身欢跃跳起、庆祝大功告成；
    - ⚠️ **预警 (warning)**：满头冷汗抱头警示，引导输入 `/compact` 压缩上下文。
  - **5 大待机随机彩蛋**（待机空闲时每隔 15~30 秒自动随机播放，或通过右键菜单直接体验）：
    - 👋 **挥手 (wave)**：热情打招呼；
    - ⭐ **崇拜 (starry)**：眼里满是小星星；
    - ✨ **开心 (cheerful)**：开怀笑逐颜开；
    - 😳 **害羞 (shy)**：脸红躲避视线；
    - ❓ **困惑 (confused)**：歪头猫猫挠头。
- ⚡ **双缓冲内存无缝切换引擎 (Zero Glitch Engine)**：
  - 本地透明 WebM 视频在首次挂载时自动预加载至内存 Blob URL 缓存池；
  - 双视频图层原子级单帧交替缓冲，首帧解码仅需 **1~3ms**，**彻底消灭黑屏闪烁与双角色重影**！
- 📊 **原生 React Fiber 全模型额度与用量分析中心**：
  - 自动识别当前会话模型（Gemini 3.8 Flash / Gemini 4 Hydrogen / Gemini 4 Argon / Claude & GPT），实时展示 5 小时与周配额及重置倒计时，并支持 HUD 顶部一键切换/总览全部模型额度池；
  - 支持按当前所在对话框路由精确切换上下文占用、实时显示 **本对话累计 Token 总量** 与真实 `tok/s` 生成速率；
  - 内置 **用量统计弹窗（活动概览热力图 + 按模型用量详情）**，本地自动归档每日、每周、每月各模型输入/缓存/输出明细。
- 🚀 **后台任务感知与一键穿梭**：
  - 自动感知后台所有正在运行的 Agent 任务；
  - 右键呼出菜单可直接查看任务进度，点击任意任务卡片**一键跳转切入该任务对话**！
- 🔄 **自动检测新版本与一键配置更新**：
  - 启动时自动静默对比 GitHub 仓库最新 Release 与 Commit，有新功能发布时猫娘自动冒泡提示；
  - 右键菜单提供专属「🚀 版本状态」卡片与「🔄 检查更新」，点击「⚡ 立即一键配置更新」全自动增量拉取最新代码并热重载生效，零命令门槛！
- 💬 **50+ 句傲娇精选台词与点击互动**：
  - 轻触或连戳猫娘触发果冻回弹动效与傲娇趣味台词。

---

## ⚡ 一句话极速安装 (推荐)

在您电脑上的 **Google Antigravity** 任意对话窗口中，直接对 Agent 发送下面这一句话：

```text
帮我安装这个 Antigravity 插件：https://github.com/Deborah3243565/antigravity-catgirl-pet
```

> **为什么能一句话安装？**  
> Antigravity 的 AI Agent 会自动执行 `git clone` 将本仓库克隆到全局插件目录 `~/.gemini/config/plugins/antigravity-catgirl-pet`。克隆完成后，Antigravity 会自动识别 `plugin.json`、`hooks.json` 与 `skills`，开箱即用！

---

## 🛠️ 手动安装 (Terminal)

如果您更喜欢通过终端命令行手动安装：

### 1. 克隆至 Antigravity 全局插件目录

**Windows (PowerShell)**：
```powershell
git clone https://github.com/Deborah3243565/antigravity-catgirl-pet.git "$env:USERPROFILE\.gemini\config\plugins\antigravity-catgirl-pet"
```

**macOS / Linux**：
```bash
git clone https://github.com/Deborah3243565/antigravity-catgirl-pet.git ~/.gemini/config/plugins/antigravity-catgirl-pet
```

### 2. 生效与运行

1. 打开或重启 **Antigravity**；
2. 当会话开启时，`hooks.json` 会通过 `SessionStart` 生命周期钩子自动挂载桌宠；
3. 如需在当前界面立即挂载，可在终端运行：
   ```bash
   node "$env:USERPROFILE\.gemini\config\plugins\antigravity-catgirl-pet\scripts\inject_pet.js"
   ```

---

## 🎮 操作指南

| 交互方式 | 触发效果 |
| :--- | :--- |
| **鼠标左键拖拽** | 1:1 精确跟踪光标，带视口边界防飞出碰撞保护与释放果冻回弹 |
| **鼠标滚轮** | 40% ~ 250% 自由无级缩放大小，并自动记忆保存配置 |
| **鼠标左键单击** | 触发猫娘眨眼跳跃并弹出傲娇对话气泡 |
| **双击角色 / 点击肚皮胶囊** | 展开 / 收起高科技 Token 消耗与官方额度 HUD 看板 |
| **鼠标右键点击** | 呼出紧凑控制面板（智能侧边弹出避让，绝不遮挡桌宠立绘全图）：<br>• 查看后台运行任务并一键跳转会话<br>• 核心动作姿态即时切换<br>• 5 大待机彩蛋直接试看体验<br>• 缩放比例滑块与预设档位（70%、100%、130%、160%）<br>• 🚀 GitHub 远程版本自动检测与一键配置更新<br>• 置顶开关、一键归位右下角 |

---

## 📁 项目目录结构

```text
antigravity-catgirl-pet/
├── assets/                  # 静态切片、插件图标与 18 款 60fps WebM 动作视频
│   ├── gemini/              # 原版透明 60fps WebM 动作资源库
│   │   ├── idle/            # 待机视频 motion.webm
│   │   ├── jump/            # 庆祝跳跃 motion.webm
│   │   ├── reviewing/       # 思考 motion.webm
│   │   ├── emotion-frightened/ # 预警流汗 motion.webm
│   │   ├── wave/            # 挥手彩蛋 motion.webm
│   │   └── ...              # 崇拜、开心、害羞、困惑等全部动作
│   └── logo.png             # 插件高清展示图标
├── scripts/
│   ├── inject_pet.js        # 核心挂载器：双缓冲切帧引擎、拖拽物理、HUD看板、智能避让菜单与CDP注入
│   ├── notify.py            # 状态通知脚本：供 Hook 或 CLI 调用触发姿态切换
│   └── update_pet.js        # 自动更新引擎：GitHub 远程 Release/Commit 检测与一键全自动升级
├── sidecars/
│   └── pet-widget/          # 辅助侧边栏与本地本地资产轻量服务
│       ├── index.html       # 独立侧边栏 Web 界面
│       ├── server.py        # 资产静态服务、任务感知、配置持久化与更新 API
│       └── sidecar.json     # Sidecar 配置文件
├── skills/
│   └── catgirl-pet/         # Antigravity 官方技能包定义
│       └── SKILL.md         # 技能说明与操作指导
├── hooks.json               # 会话生命周期联动钩子配置
├── plugin.json              # Antigravity 插件清单配置
└── README.md                # 项目文档
```

---

## 🔖 版本更新记录 (Changelog)

### v1.2.0 (Current)
- ⌨️ **全息敲码动作与指尖键帽联动**：为敲码态构建 3D 透视全息悬浮键盘与高亮按键反馈，伴随代码粒子流，敲击手感更自然；
- 🖥️ **高倍缩放 HUD 适配**：为仪表盘加入反缩放补偿，在 130%+ 桌宠缩放比例下 HUD 依然保持紧凑清晰不膨胀；
- 🎯 **分对话上下文精准切换 & 真实指标审计**：依据当前对话路由（`/c/<id>`）独立隔离上下文水位，修复跨天增量统计与真实 `tok/s` 生成速率；
- 🧮 **本对话累计 Token 总量**：HUD「📊 Token 消耗」面板与悬停胶囊新增当前对话框从开始至今的完整累计 Token 总量与请求次数显示；
- 📈 **全新用量统计与全模型额度中心**：HUD 内置「📈 用量详情 & 全额度」入口与顶部快速额度池切换条，支持 **活动热力图（日/周）**、**按模型用量柱状图与明细表**，以及 **全部模型额度一屏总览**。

### v1.1.0
- 🌟 **持久缩放与配置记忆**：支持多路径磁盘持久化，重新打开 Antigravity 始终精准还原所设大小（默认推荐 130% 放大比例）；
- 🚀 **GitHub 自动更新与一键配置**：启动静默检查远程新版本与提交，右键菜单支持一键拉取最新代码并热重载生效，零命令行门槛；
- 📐 **控制菜单紧凑化与智能侧边弹出避让**：右键面板采用高科技紧凑排版，自动弹出在桌宠侧边（左/右侧保留 12px 呼吸间隙），**绝不遮挡桌宠立绘全图**，图片细节与面板选项清晰可见。

### v1.0.0
- 🎉 首次正式开源发布：支持 10 款 60fps 透明 WebM 细腻动作、双缓冲无黑屏切帧引擎、原生配额看板与 QQ 弹弹果冻拖拽物理。

---

## 📋 环境要求

- **操作系统**：Windows 10/11、macOS 或 Linux
- **Antigravity**：已安装并运行 Google Antigravity
- **运行环境**：
  - Node.js 18+（用于 CDP 注入）
  - Python 3.8+（自带标准库即可，无需额外 pip 安装）

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。欢迎提交 Issue 与 Pull Request！
