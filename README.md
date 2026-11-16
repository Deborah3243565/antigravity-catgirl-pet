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
- 📊 **原生 React Fiber 配额看板 (无需外部依赖)**：
  - 自动识别当前会话正在使用的模型（Gemini 3.8 Flash / Gemini 4 Argon / Claude & GPT），原生直连官方 5 小时与周配额池；
  - 实时显示配额百分比与精确重置倒计时（如 `5h 88% 3h12m`）；
  - 肚皮实时 Token 胶囊，双击角色或点击胶囊即可展开高科技 HUD 数据看板。
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
git clone https://github.com/<你的用户名>/antigravity-catgirl-pet.git "$env:USERPROFILE\.gemini\config\plugins\antigravity-catgirl-pet"
```

**macOS / Linux**：
```bash
git clone https://github.com/<你的用户名>/antigravity-catgirl-pet.git ~/.gemini/config/plugins/antigravity-catgirl-pet
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
| **鼠标右键点击** | 呼出功能菜单：<br>• 查看后台运行任务并一键跳转会话<br>• 核心动作姿态即时切换<br>• 5 大待机彩蛋直接试看<br>• 缩放比例滑块与预设档位（70%、100%、130%）<br>• 置顶开关、一键归位右下角 |

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
│   ├── inject_pet.js        # 核心挂载器：双缓冲切帧引擎、拖拽物理、HUD看板与CDP注入
│   └── notify.py            # 状态通知脚本：供 Hook 或 CLI 调用触发姿态切换
├── sidecars/
│   └── pet-widget/          # 辅助侧边栏与本地本地资产轻量服务
│       ├── index.html       # 独立侧边栏 Web 界面
│       ├── server.py        # 资产静态服务、任务感知与原生用量聚合
│       └── sidecar.json     # Sidecar 配置文件
├── skills/
│   └── catgirl-pet/         # Antigravity 官方技能包定义
│       └── SKILL.md         # 技能说明与操作指导
├── hooks.json               # 会话生命周期联动钩子配置
├── plugin.json              # Antigravity 插件清单配置
└── README.md                # 项目文档
```

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
