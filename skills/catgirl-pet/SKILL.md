---
name: catgirl-pet
description: 控制和管理 Antigravity 星星猫娘桌宠挂件。支持切换 10 款 60fps 细腻姿态（待机、敲代码、思考、庆祝、预警及 5 款待机彩蛋）、推送气泡通知与检查桌宠运行状态。
---

# 星星猫娘桌宠管理技能 (Catgirl Pet Skill)

本技能用于控制与互动 Gemini 星星猫娘桌宠挂件。桌宠常驻于 Antigravity 软件窗口内右下角，具备弹性果冻拖拽物理、滚轮无级缩放、双缓冲无缝视频切换、原生 React Fiber 配额看板与多任务切入感知。

## 常用操作

### 1. 手动触发猫娘动作与气泡
当需要向用户展示特定动作，或任务节点需要提醒时，运行通知脚本：

```bash
python scripts/notify.py --state <state> --detail "<气泡文案>"
```
（全局安装路径下为：`python ~/.gemini/config/plugins/antigravity-catgirl-pet/scripts/notify.py --state <state> --detail "<气泡文案>"`）

#### 支持的核心姿态 (`<state>`)：
- `idle`：待机呼吸与灵动眨眼
- `coding`：全息键盘双爪交替敲击写代码与飞溅字符
- `thinking`：托腮沉思
- `celebrate`：全身欢跃跳起、庆祝大功告成
- `warning`：满头冷汗警示（提醒执行 `/compact` 压缩上下文）

#### 支持的 5 款待机彩蛋姿态：
- `wave`：热情挥舞小爪子打招呼
- `starry`：满眼小星星、崇拜主人
- `cheerful`：开怀笑逐颜开
- `shy`：脸红害羞
- `confused`：歪头困惑

### 2. 挂载与重绘桌宠
```bash
node scripts/inject_pet.js
```

### 3. 呼出桌宠辅助面板
向用户提供专属面板链接：
`[星星猫娘桌宠](sidecar://antigravity-catgirl-pet/pet-widget/)`
用户点击即可在 Antigravity 辅助侧边栏开启挂件！
