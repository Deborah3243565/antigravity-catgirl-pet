const fs = require('fs');
const path = require('path');
const http = require('http');

function getCdpPort() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const portCandidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Antigravity', 'DevToolsActivePort') : null,
    home ? path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort') : null,
    home ? path.join(home, '.config', 'Antigravity', 'DevToolsActivePort') : null,
    home ? path.join(home, '.config', 'antigravity', 'DevToolsActivePort') : null
  ].filter(Boolean);

  for (const p of portCandidates) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
      const portNum = parseInt(lines[0].trim(), 10);
      if (!isNaN(portNum) && portNum > 0) return portNum;
    }
  }
  throw new Error('未找到 DevToolsActivePort 文件，请确认 Antigravity 正在运行');
}

function getBase64Images() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const files = ['idle', 'thinking', 'coding', 'celebrate', 'warning', 'wave', 'starry', 'cheerful', 'shy', 'confused'];
  const res = {};
  for (const f of files) {
    const p = path.join(assetsDir, `${f}.png`);
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p).toString('base64');
      res[f] = `data:image/png;base64,${data}`;
    }
  }
  return res;
}

async function main() {
  const isEnsure = process.argv.includes('--ensure');
  let port;
  try {
    port = getCdpPort();
  } catch (err) {
    if (!isEnsure) console.error(`[星星猫娘] 错误: ${err.message}`);
    return;
  }
  if (!isEnsure) console.log(`[星星猫娘] 获取到 Antigravity 调试端口: ${port}`);

  let sidecarPort = 18980;
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const portCandidates = [
      path.join(__dirname, '..', 'sidecars', 'pet-widget', '.port'),
      path.join(__dirname, '..', '.port'),
      path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet', 'sidecars', 'pet-widget', '.port'),
      path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet', '.port')
    ];
    for (const p of portCandidates) {
      if (fs.existsSync(p)) {
        const val = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
        if (val > 0) { sidecarPort = val; break; }
      }
    }
  } catch (e) {}

  const images = getBase64Images();

  http.get(`http://127.0.0.1:${port}/json`, (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      let list = [];
      try {
        list = JSON.parse(raw);
      } catch (e) {
        return;
      }
      // 优先筛选真正的 Antigravity 主工作区窗口（排除 data: 开头的加载闪屏）
      let pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && t.url && !t.url.startsWith('data:'));
      if (!pages || pages.length === 0) {
        pages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
      }
      if (!pages || pages.length === 0) {
        if (!isEnsure) console.error('未找到可用的 Antigravity 界面');
        return;
      }

      pages.forEach((page) => {
        try {
          const ws = new WebSocket(page.webSocketDebuggerUrl);

          ws.onopen = () => {
            if (isEnsure) {
              // 快速检查挂件是否已存在
              ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression: 'Boolean(document.getElementById("antigravity-catgirl-dock"))' }
              }));
              return;
            }
            // 强制/全新注入
            if (!isEnsure) console.log(`[星星猫娘] 正在注入 Antigravity 主界面: ${page.title}`);
            sendClientScript(ws);
          };

          ws.onmessage = (msg) => {
            try {
              const res = JSON.parse(msg.data);
              if (res.id === 1) {
                const exists = res.result?.result?.value;
                if (exists) {
                  ws.close();
                  return;
                }
                // 不存在时注入
                console.log(`[星星猫娘] 检测到界面未挂载，正在启动注入: ${page.title}`);
                sendClientScript(ws);
              } else if (res.id === 105) {
                if (res.result?.exceptionDetails) {
                  console.error('[星星猫娘] 挂载脚本执行异常:', JSON.stringify(res.result.exceptionDetails));
                } else if (!isEnsure) {
                  console.log(`[星星猫娘] 挂载完成: ${page.title}`);
                }
                ws.close();
              }
            } catch (err) {
              ws.close();
            }
          };

          ws.onerror = () => ws.close();
        } catch (e) {}
      });

      function sendClientScript(ws) {
        const clientScript = `
          (function() {
            window.__catgirl_sidecar_port = ${sidecarPort};
            function mountPet() {
              if (!document.body || !document.head) {
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', mountPet, { once: true });
                } else {
                  setTimeout(mountPet, 50);
                }
                return;
              }
              const IMAGES = ${JSON.stringify(images)};

            // 移除旧挂件与菜单，清理所有全局监听器与连接
            if (typeof window.__catgirl_cleanup === 'function') {
              try { window.__catgirl_cleanup(); } catch(e) {}
            }
            if (window.__catgirl_sync_timer) {
              clearInterval(window.__catgirl_sync_timer);
              window.__catgirl_sync_timer = null;
            }
            if (window.__catgirl_sse) {
              try { window.__catgirl_sse.close(); } catch(e) {}
              window.__catgirl_sse = null;
            }
            const oldDock = document.getElementById('antigravity-catgirl-dock');
            if (oldDock) oldDock.remove();
            const oldMenu = document.getElementById('antigravity-catgirl-contextmenu');
            if (oldMenu) oldMenu.remove();
            const oldHud = document.getElementById('catgirl-dashboard-hud');
            if (oldHud) oldHud.remove();

            const mountAbortController = new AbortController();
            const { signal } = mountAbortController;

            let idleEggTimer = null;
            let eggTimer = null;

            window.__catgirl_cleanup = () => {
              mountAbortController.abort();
              if (window.__catgirl_sync_timer) {
                clearInterval(window.__catgirl_sync_timer);
                window.__catgirl_sync_timer = null;
              }
              if (window.__catgirl_sse) {
                try { window.__catgirl_sse.close(); } catch(e) {}
                window.__catgirl_sse = null;
              }
              if (idleEggTimer) {
                clearTimeout(idleEggTimer);
                idleEggTimer = null;
              }
              if (eggTimer) {
                clearTimeout(eggTimer);
                eggTimer = null;
              }
              if (typeof window.__catgirl_stop_coding_fx === 'function') {
                try { window.__catgirl_stop_coding_fx(); } catch(e) {}
              }
            };

            // 注入更新样式
            let style = document.getElementById('antigravity-catgirl-style');
            if (!style) {
              style = document.createElement('style');
              style.id = 'antigravity-catgirl-style';
              document.head.appendChild(style);
            }

            style.textContent = \`
              /* 宏观定位根容器：固定宽度 120px，绝不受文字或气泡长短影响！ */
              #antigravity-catgirl-dock {
                position: fixed;
                bottom: 24px;
                right: 32px;
                width: 120px;
                z-index: 99999999;
                user-select: none;
                pointer-events: auto;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                transform-origin: bottom center;
                touch-action: none;
              }

              /* 物理主体容器：严格锁死 120px 居中中轴线 */
              #catgirl-body {
                position: relative;
                width: 120px;
                display: flex;
                flex-direction: column;
                align-items: center;
                cursor: grab;
              }
              #catgirl-body:active {
                cursor: grabbing;
              }

              /* 1. 白底不透明气泡：自适应视口碰撞贴边避让，尺寸比下方文本框(96px)略大一点点 */
              #catgirl-bubble-wrap {
                position: absolute;
                bottom: calc(100% + 10px);
                left: 50%;
                --bubble-shift-x: 0px;
                transform: translateX(calc(-50% + var(--bubble-shift-x))) translateY(6px);
                opacity: 0;
                transition: opacity 0.22s ease-out, transform 0.22s ease-out;
                pointer-events: none;
                z-index: 100;
                display: flex;
                flex-direction: column;
                align-items: center;
                width: max-content;
                max-width: 118px;
              }
              #catgirl-bubble-wrap.show {
                opacity: 1;
                transform: translateX(calc(-50% + var(--bubble-shift-x))) translateY(0);
              }
              #catgirl-bubble-box {
                background: #ffffff !important;
                color: #0f172a !important;
                font-size: 10.5px;
                font-weight: 600;
                line-height: 1.4;
                padding: 5px 8px;
                border-radius: 9px;
                box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.06);
                border: 1px solid rgba(226, 232, 240, 0.95);
                text-align: center;
                white-space: normal;
                word-break: break-word;
              }
              #catgirl-bubble-arrow {
                width: 0;
                height: 0;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 5px solid #ffffff;
                margin-top: -1px;
                transition: transform 0.22s ease-out;
              }

              /* 2. 动画受体舞台（双层架构：底层防黑屏静态垫底，上层 60fps 平滑淡入动态 WebM） */
              #catgirl-anim-stage {
                position: relative;
                width: 120px;
                height: 135px;
                display: flex;
                justify-content: center;
                align-items: flex-end;
                transform-origin: bottom center;
                will-change: transform;
              }

              #catgirl-img {
                width: 110px;
                height: 100%;
                object-fit: contain;
                display: block;
                filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.45));
                pointer-events: none;
                user-select: none;
                transition: opacity 0.15s ease, transform 0.2s ease;
              }

              .catgirl-video-layer {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: contain;
                filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.45));
                pointer-events: none;
                opacity: 0;
                display: none;
                transition: none !important;
              }

              /* 互动 1：纯垂直跳跃 */
              @keyframes lockedJump {
                0% { transform: translateY(0) scale(1, 1); }
                25% { transform: translateY(4px) scale(1.1, 0.9); }
                50% { transform: translateY(-24px) scale(0.94, 1.08); }
                75% { transform: translateY(0) scale(1.06, 0.94); }
                90% { transform: translateY(-3px) scale(0.99, 1.01); }
                100% { transform: translateY(0) scale(1, 1); }
              }
              .pet-anim-jump {
                animation: lockedJump 0.45s cubic-bezier(0.25, 1, 0.5, 1) !important;
              }

              /* 互动 2：纯对称压扁回弹 */
              @keyframes lockedSquash {
                0% { transform: scale(1, 1); }
                30% { transform: scale(1.24, 0.76) translateY(6px); }
                55% { transform: scale(0.88, 1.15) translateY(-5px); }
                75% { transform: scale(1.06, 0.96) translateY(1px); }
                90% { transform: scale(0.99, 1.01); }
                100% { transform: scale(1, 1) translateY(0); }
              }
              .pet-anim-squash {
                animation: lockedSquash 0.48s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
              }

              /* 互动 3：轻柔对称微摆 */
              @keyframes lockedWiggle {
                0% { transform: rotate(0deg); }
                25% { transform: rotate(-5deg); }
                50% { transform: rotate(5deg); }
                75% { transform: rotate(-2.5deg); }
                100% { transform: rotate(0deg); }
              }
              .pet-anim-wiggle {
                animation: lockedWiggle 0.4s ease-in-out !important;
              }

              /* Duang 弹性动画 */
              @keyframes lockedDuang {
                0% { transform: scale(1); }
                25% { transform: scale(1.3, 0.72) translateY(6px); }
                50% { transform: scale(0.85, 1.2) translateY(-18px); }
                75% { transform: scale(1.08, 0.94); }
                100% { transform: scale(1); }
              }
              .pet-anim-duang {
                animation: lockedDuang 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
              }

              /* 待机自然呼吸与眨眼动效 */
              @keyframes petNaturalBlink {
                0%, 90%, 100% {
                  transform: scale(1, 1);
                }
                94% {
                  transform: scale(1.03, 0.91) translateY(1px); /* 俏皮微眨眼与呼吸微蹲 */
                }
                97% {
                  transform: scale(0.99, 1.01);
                }
              }
              .pet-idle-blink {
                animation: petNaturalBlink 5.5s infinite ease-in-out;
              }

              /* 预警惊恐慌乱高频颤抖动效 (Panic Tremble) */
              @keyframes petPanicTremble {
                0% { transform: translateY(0) rotate(0deg) scale(1); }
                20% { transform: translateY(-2px) rotate(-3.5deg) scale(0.98, 1.02); }
                40% { transform: translateY(1.5px) rotate(3deg) scale(1.02, 0.98); }
                60% { transform: translateY(-1.5px) rotate(-2.5deg) scale(0.99, 1.01); }
                80% { transform: translateY(2px) rotate(2deg) scale(1.01, 0.99); }
                100% { transform: translateY(0) rotate(0deg) scale(1); }
              }
              .pet-anim-warning {
                animation: petPanicTremble 0.26s infinite ease-in-out !important;
              }

              /* 预警冷汗流汗粒子动画 */
              .sweat-drop {
                position: absolute;
                top: 14px;
                right: 20px;
                width: 9px;
                height: 14px;
                background: linear-gradient(180deg, #38bdf8 0%, #60a5fa 100%);
                border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
                box-shadow: 0 0 6px rgba(56, 189, 248, 0.85);
                opacity: 0;
                animation: sweatDrip 1.2s infinite ease-in;
                pointer-events: none;
                z-index: 25;
              }
              @keyframes sweatDrip {
                0% { opacity: 0; transform: translateY(-4px) scale(0.6); }
                30% { opacity: 0.95; transform: translateY(0) scale(1); }
                80% { opacity: 0.95; transform: translateY(14px) scale(0.9); }
                100% { opacity: 0; transform: translateY(20px) scale(0.4); }
              }

              /* 思考托腮沉思灵动微晃 */
              @keyframes petThinkingSway {
                0%, 100% { transform: translateY(0) rotate(0deg); }
                25% { transform: translateY(-2px) rotate(-2deg); }
                50% { transform: translateY(0.5px) rotate(0deg); }
                75% { transform: translateY(-1.5px) rotate(2deg); }
              }
              .pet-anim-thinking {
                animation: petThinkingSway 3s infinite ease-in-out !important;
              }

              /* 挥手热情摇摆动效 */
              @keyframes petWaveSwing {
                0%, 100% { transform: rotate(0deg) translateY(0); }
                20% { transform: rotate(-5.5deg) translateY(-3px); }
                40% { transform: rotate(4.5deg) translateY(0); }
                60% { transform: rotate(-4deg) translateY(-2px); }
                80% { transform: rotate(3deg) translateY(0); }
              }
              .pet-anim-wave {
                animation: petWaveSwing 1.7s infinite ease-in-out !important;
              }

              /* 崇拜双眼冒小星星心跳小跳步 */
              @keyframes petStarryHop {
                0%, 100% { transform: translateY(0) scale(1, 1); }
                20% { transform: translateY(-13px) scale(0.94, 1.09); }
                40% { transform: translateY(0) scale(1.09, 0.93); }
                60% { transform: translateY(-7px) scale(0.97, 1.04); }
                80% { transform: translateY(0) scale(1.02, 0.98); }
              }
              .pet-anim-starry {
                animation: petStarryHop 1.6s infinite ease-in-out !important;
              }

              /* 开心扭腰欢快跳跃动效 */
              @keyframes petCheerfulDance {
                0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
                25% { transform: translateY(-5px) rotate(-4.5deg) scale(1.03); }
                50% { transform: translateY(0) rotate(0deg) scale(1); }
                75% { transform: translateY(-5px) rotate(4.5deg) scale(1.03); }
              }
              .pet-anim-cheerful {
                animation: petCheerfulDance 1.5s infinite ease-in-out !important;
              }

              /* 害羞微侧身娇羞扭捏动效 */
              @keyframes petShyTwist {
                0%, 100% { transform: rotate(0deg) scale(1) translateY(0); }
                30% { transform: rotate(-3.5deg) scale(0.96, 1.02) translateY(2px); }
                70% { transform: rotate(2.5deg) scale(0.98, 1.01) translateY(1px); }
              }
              .pet-anim-shy {
                animation: petShyTwist 2.4s infinite ease-in-out !important;
              }

              /* 困惑歪头杀摸脑勺慢晃动效 */
              @keyframes petConfusedTilt {
                0%, 100% { transform: rotate(0deg) translateY(0); }
                30% { transform: rotate(-8deg) translateY(-1.5px) scale(1.02); }
                70% { transform: rotate(6deg) translateY(1px) scale(1.01); }
              }
              .pet-anim-confused {
                animation: petConfusedTilt 2.8s infinite ease-in-out !important;
              }

              /* 状态徽章 */
              #catgirl-status-badge {
                position: absolute;
                bottom: 4px;
                right: 4px;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                background: #3b82f6;
                border: 2px solid #ffffff;
                color: #ffffff;
                font-size: 11px;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 3px 8px rgba(0,0,0,0.35);
              }

              /* 敲代码微震颤与身体律动 */
              @keyframes codingJitter {
                0%, 100% { transform: translateY(0) rotate(0deg); }
                20% { transform: translateY(-0.8px) rotate(-0.3deg); }
                40% { transform: translateY(0.4px) rotate(0.2deg); }
                60% { transform: translateY(-0.5px) rotate(-0.2deg); }
                80% { transform: translateY(0.3px) rotate(0.15deg); }
              }
              .coding-jitter {
                animation: codingJitter 0.38s infinite ease-in-out !important;
              }

              /* 赛博全息发光键盘 (Holographic Cyber Keyboard) */
              #catgirl-holo-keyboard {
                position: absolute;
                bottom: 32px;
                left: 50%;
                width: 84px;
                height: 26px;
                transform: translateX(-50%) perspective(240px) rotateX(26deg);
                transform-origin: center bottom;
                background: linear-gradient(135deg, rgba(56, 189, 248, 0.32) 0%, rgba(168, 85, 247, 0.36) 100%);
                border: 1px solid rgba(125, 211, 252, 0.8);
                border-radius: 4px;
                box-shadow: 0 0 14px rgba(56, 189, 248, 0.6), inset 0 0 8px rgba(168, 85, 247, 0.5);
                backdrop-filter: blur(1.5px);
                padding: 2.5px 3.5px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                pointer-events: none;
                z-index: 10;
                opacity: 1;
                transition: opacity 0.28s ease, transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
              }

              #catgirl-holo-keyboard.holo-hidden {
                opacity: 0;
                transform: translateX(-50%) perspective(240px) rotateX(26deg) scale(0.65) translateY(10px);
                pointer-events: none;
              }

              /* 敲击双手容器与拟真落键物理动效 */
              #typing-hands-container {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 15;
              }
              .typing-hand {
                position: absolute;
                top: -10px;
                width: 22px;
                height: 15px;
                display: flex;
                flex-direction: column;
                align-items: center;
                transition: transform 0.08s cubic-bezier(0.1, 0.9, 0.2, 1);
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
              }
              #typing-hand-left {
                left: 10px;
                transform-origin: top center;
              }
              #typing-hand-right {
                right: 10px;
                transform-origin: top center;
              }
              .hand-cuff {
                width: 14px;
                height: 6px;
                background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                border-radius: 4px 4px 2px 2px;
                border: 1px solid rgba(255, 255, 255, 0.7);
                box-shadow: 0 0 6px rgba(139, 92, 246, 0.6);
              }
              .hand-palm {
                width: 13px;
                height: 9px;
                background: #fff5f0;
                border-radius: 4px 4px 6px 6px;
                margin-top: -1px;
                border: 1px solid rgba(254, 205, 211, 0.9);
                position: relative;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
              }
              .hand-palm::after {
                content: '';
                position: absolute;
                bottom: 1.5px;
                left: 50%;
                transform: translateX(-50%);
                width: 7px;
                height: 3px;
                background: #f472b6;
                border-radius: 3px;
                opacity: 0.8;
              }
              /* 敲击瞬间准确下压 */
              .typing-hand.hand-down {
                transform: translateY(4.5px) scale(0.92) !important;
              }

              /* 键盘发光网格按键 */
              .holo-key-row {
                display: flex;
                gap: 1.5px;
                width: 100%;
                justify-content: center;
              }
              .holo-key {
                flex: 1;
                height: 4.5px;
                background: rgba(255, 255, 255, 0.38);
                border-radius: 1px;
                box-shadow: 0 0 2px rgba(56, 189, 248, 0.8);
                transition: background 0.08s ease, transform 0.08s ease, box-shadow 0.08s ease;
              }
              .holo-key.active-tap {
                background: #ffffff !important;
                transform: scale(1.25) translateY(-1px);
                box-shadow: 0 0 8px #ffffff, 0 0 14px #38bdf8 !important;
              }
              .holo-key-space {
                flex: 3;
              }

              /* 全息底部扫描微光 */
              .holo-scanline {
                position: absolute;
                inset: 0;
                background: linear-gradient(180deg, transparent 0%, rgba(56, 189, 248, 0.25) 50%, transparent 100%);
                animation: holoScan 1.6s linear infinite;
                pointer-events: none;
                border-radius: 4px;
              }
              @keyframes holoScan {
                0% { transform: translateY(-100%); opacity: 0; }
                50% { opacity: 0.8; }
                100% { transform: translateY(100%); opacity: 0; }
              }

              /* 飞溅代码粒子容器与动画 */
              #catgirl-code-particles {
                position: absolute;
                inset: 0;
                pointer-events: none;
                overflow: visible;
                z-index: 12;
              }
              .code-particle {
                position: absolute;
                font-family: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, monospace;
                font-weight: 800;
                font-size: 9.5px;
                line-height: 1;
                white-space: nowrap;
                user-select: none;
                pointer-events: none;
                animation: particleFloat 0.9s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
              }
              @keyframes particleFloat {
                0% {
                  opacity: 0;
                  transform: translate(0, 0) scale(0.65);
                }
                25% {
                  opacity: 1;
                  transform: translate(var(--p-dx, 0px), -15px) scale(1.1);
                }
                100% {
                  opacity: 0;
                  transform: translate(calc(var(--p-dx, 0px) * 1.6), -48px) scale(0.85);
                }
              }

              /* 肚皮 Token 水位精致迷你胶囊（与桌宠宽度严格贴合） */
              #live-catgirl-token-pill {
                margin-top: -6px;
                padding: 4px 6px;
                border-radius: 9px;
                background: #ffffff !important;
                border: 1px solid rgba(226, 232, 240, 0.95) !important;
                color: #0f172a !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                cursor: pointer;
                width: 96px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                gap: 2.5px;
                box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);
                backdrop-filter: blur(12px);
                transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease, border-color 0.18s ease;
                user-select: none;
              }
              #live-catgirl-token-pill:hover {
                transform: translateY(-2px) scale(1.04);
                box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12), 0 2px 4px rgba(15, 23, 42, 0.06);
                border-color: #cbd5e1 !important;
              }
              .pill-row-top {
                display: flex;
                align-items: center;
                gap: 3px;
                line-height: 1;
                width: 100%;
              }
              #live-catgirl-token-dot {
                width: 5px;
                height: 5px;
                border-radius: 50%;
                background: #10b981;
                box-shadow: 0 0 5px rgba(16, 185, 129, 0.45);
                flex-shrink: 0;
                transition: background 0.25s ease, box-shadow 0.25s ease;
              }
              .pill-label {
                font-size: 8.5px;
                font-weight: 600;
                color: #64748b;
                flex-shrink: 0;
              }
              .pill-val-bold {
                font-size: 9.5px;
                font-weight: 700;
                color: #0f172a;
                letter-spacing: -0.2px;
                flex-shrink: 0;
              }
              .pill-val-sub {
                font-size: 8px;
                font-weight: 500;
                color: #94a3b8;
                margin-left: auto;
                white-space: nowrap;
                letter-spacing: -0.1px;
              }
              .pill-track {
                width: 100%;
                height: 2px;
                background: #f1f5f9;
                border-radius: 1px;
                overflow: hidden;
              }
              .pill-bar {
                height: 100%;
                width: 0%;
                border-radius: 1px;
                background: linear-gradient(90deg, #3b82f6, #6366f1);
                transition: width 0.3s ease, background 0.3s ease;
              }
              .pill-row-bottom {
                display: flex;
                align-items: center;
                gap: 3px;
                line-height: 1;
                width: 100%;
                margin-top: 0.5px;
              }
              .pill-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1.15;
              }
              .pill-badge-quota {
                background: #eff6ff;
                color: #2563eb;
                border: 1px solid #dbeafe;
                font-size: 8px;
                font-weight: 600;
                padding: 1px 3px;
                border-radius: 4px;
                white-space: nowrap;
                flex-shrink: 0;
              }
              .pill-badge-model {
                background: #f8fafc;
                color: #475569;
                border: 1px solid #e2e8f0;
                font-size: 8px;
                font-weight: 500;
                padding: 1px 3px;
                border-radius: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 48px;
                margin-left: auto;
              }

              /* 猫娘专属 Token & 额度仪表盘 HUD 卡片（独立紧凑型防遮挡设计） */
              #catgirl-dashboard-hud {
                position: absolute;
                right: calc(100% + 12px);
                bottom: 0;
                width: 242px;
                background: rgba(15, 23, 42, 0.96);
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 14px;
                padding: 10px 12px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(20px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
                color: #f1f5f9;
                z-index: 99999999;
                transform-origin: bottom right;
                user-select: none;
                transition: opacity 0.22s ease-out, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
              }
              #catgirl-dashboard-hud.hud-hidden {
                opacity: 0;
                pointer-events: none;
                transform: translateX(12px) scale(calc(1 / var(--pet-scale, 1) * 0.8));
                display: none;
              }
              #catgirl-dashboard-hud.hud-visible {
                opacity: 1;
                pointer-events: auto;
                transform: translateX(0) scale(calc(1 / var(--pet-scale, 1) * 0.86));
                display: block;
              }
              .hud-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                margin-bottom: 10px;
              }
              .hud-title-box {
                display: flex;
                align-items: center;
                gap: 6px;
              }
              .hud-title {
                font-size: 12px;
                font-weight: 700;
                color: #f8fafc;
                letter-spacing: -0.2px;
              }
              .hud-actions {
                display: flex;
                align-items: center;
                gap: 6px;
              }
              .hud-badge {
                font-size: 9.5px;
                padding: 1.5px 6px;
                border-radius: 8px;
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid rgba(96, 165, 250, 0.4);
                color: #93c5fd;
                font-weight: 500;
                max-width: 120px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .hud-btn-icon {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 13px;
                cursor: pointer;
                line-height: 1;
                padding: 2px 5px;
                border-radius: 4px;
                transition: all 0.15s ease;
              }
              .hud-btn-icon:hover {
                color: #fff;
                background: rgba(255, 255, 255, 0.15);
              }
              .hud-section {
                margin-bottom: 10px;
              }
              .hud-section-title {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 10.5px;
                font-weight: 600;
                color: #cbd5e1;
                margin-bottom: 5px;
              }
              .hud-group-pill {
                background: rgba(30, 41, 59, 0.85);
                border: 1px solid rgba(56, 189, 248, 0.35);
                color: #38bdf8;
                font-size: 9.5px;
                font-weight: 600;
                padding: 1px 6px;
                border-radius: 9999px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                transition: all 0.16s ease;
                user-select: none;
                line-height: 1.3;
              }
              .hud-group-pill:hover {
                background: rgba(56, 189, 248, 0.22);
                border-color: #38bdf8;
                color: #7dd3fc;
                box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
                transform: translateY(-0.5px);
              }
              .hud-group-pill:active {
                transform: scale(0.96);
              }
              .hud-group-pill-arrow {
                font-size: 8px;
                opacity: 0.75;
              }
              .hud-gauge-row {
                margin-bottom: 6px;
              }
              .hud-gauge-info {
                display: flex;
                justify-content: space-between;
                font-size: 10px;
                margin-bottom: 3px;
              }
              .hud-gauge-info .hud-label {
                color: #94a3b8;
              }
              .hud-gauge-info .hud-val {
                color: #38bdf8;
                font-weight: 700;
                font-family: monospace;
              }
              .hud-track {
                width: 100%;
                height: 5px;
                border-radius: 3px;
                background: rgba(255, 255, 255, 0.1);
                overflow: hidden;
                position: relative;
              }
              .hud-fill {
                height: 100%;
                border-radius: 3px;
                transition: width 0.35s ease;
              }
              .hud-fill-five {
                background: linear-gradient(90deg, #38bdf8, #818cf8);
                box-shadow: 0 0 8px rgba(56, 189, 248, 0.4);
              }
              .hud-fill-week {
                background: linear-gradient(90deg, #34d399, #38bdf8);
                box-shadow: 0 0 8px rgba(52, 211, 153, 0.4);
              }
              .hud-fill-ctx {
                background: linear-gradient(90deg, #10b981, #f59e0b);
                box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
              }
              .hud-timer-row {
                display: flex;
                justify-content: space-between;
                font-size: 9px;
                color: #64748b;
                margin-top: 2px;
              }
              .hud-timer {
                color: #94a3b8;
                font-family: monospace;
              }
              .hud-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 5px;
              }
              .hud-metric-card {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.07);
                border-radius: 8px;
                padding: 5px 8px;
                display: flex;
                flex-direction: column;
                gap: 1px;
              }
              .hud-metric-label {
                font-size: 9px;
                color: #94a3b8;
              }
              .hud-metric-val {
                font-size: 13px;
                font-weight: 700;
                color: #f1f5f9;
                font-family: monospace;
                letter-spacing: -0.3px;
              }
              .hud-footer {
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                gap: 6px;
              }
              .hud-btn-primary {
                flex: 1;
                background: linear-gradient(135deg, #2563eb, #3b82f6);
                color: #fff;
                border: none;
                border-radius: 8px;
                padding: 6.5px 10px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: all 0.18s ease;
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
              }
              .hud-btn-primary:hover {
                background: linear-gradient(135deg, #1d4ed8, #2563eb);
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(37, 99, 235, 0.5);
              }

              /* 右键原生级卡片菜单 */
              #antigravity-catgirl-contextmenu {
                position: fixed;
                z-index: 100000000;
                background: rgba(15, 23, 42, 0.96);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 14px;
                padding: 8px;
                width: 262px;
                min-width: 245px;
                box-shadow: 0 16px 36px rgba(0,0,0,0.65);
                backdrop-filter: blur(14px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 11.5px;
                color: #f1f5f9;
                display: none;
                user-select: none;
                max-height: calc(100vh - 24px);
                overflow-y: auto;
                overflow-x: hidden;
                scrollbar-width: thin;
                scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
              }
              .catgirl-input-wrap {
                display: flex;
                align-items: center;
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid rgba(59, 130, 246, 0.5);
                border-radius: 8px;
                padding: 1px 6px;
                transition: all 0.15s ease;
              }
              .catgirl-input-wrap:focus-within {
                background: rgba(59, 130, 246, 0.4);
                border-color: #60a5fa;
                box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
              }
              .catgirl-number-input {
                width: 38px;
                background: transparent;
                border: none;
                color: #ffffff;
                font-family: monospace;
                font-size: 11px;
                font-weight: 600;
                text-align: right;
                outline: none;
                padding: 0;
              }
              .catgirl-number-input::-webkit-outer-spin-button,
              .catgirl-number-input::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
              }
              .catgirl-percent-unit {
                font-family: monospace;
                font-size: 10px;
                color: #93c5fd;
                margin-left: 2px;
                font-weight: 600;
              }

              /* 正在运行的任务列表样式 */
              #running-tasks-count-badge {
                font-size: 10px;
                padding: 1px 6px;
                border-radius: 10px;
                background: rgba(148, 163, 184, 0.2);
                border: 1px solid rgba(148, 163, 184, 0.35);
                color: #cbd5e1;
                font-weight: 600;
              }
              #running-tasks-count-badge.is-running {
                background: rgba(6, 182, 212, 0.25);
                border-color: rgba(34, 211, 238, 0.65);
                color: #67e8f9;
              }
              .catgirl-tasks-list {
                display: flex;
                flex-direction: column;
                gap: 5px;
                margin-top: 4px;
                max-height: 135px;
                overflow-y: auto;
              }
              .catgirl-task-item {
                background: rgba(15, 23, 42, 0.82);
                border: 1px solid rgba(56, 189, 248, 0.35);
                border-radius: 8px;
                padding: 6px 8px;
                display: flex;
                flex-direction: column;
                gap: 3px;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                user-select: none;
                position: relative;
              }
              .catgirl-task-item:hover {
                background: rgba(30, 41, 59, 0.95);
                border-color: #38bdf8;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(56, 189, 248, 0.28);
              }
              .catgirl-task-item:active {
                transform: scale(0.97);
              }
              .catgirl-task-arrow {
                margin-left: auto;
                font-size: 11px;
                color: #38bdf8;
                opacity: 0.65;
                transition: transform 0.2s, opacity 0.2s, color 0.2s;
              }
              .catgirl-task-item:hover .catgirl-task-arrow {
                opacity: 1;
                transform: translateX(3px);
                color: #7dd3fc;
              }
              .catgirl-task-top {
                display: flex;
                align-items: center;
                gap: 5px;
                font-size: 11px;
                font-weight: 600;
                color: #f8fafc;
              }
              .catgirl-task-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #06b6d4;
                box-shadow: 0 0 6px #22d3ee;
                flex-shrink: 0;
                animation: catgirlTaskPulse 1.4s infinite ease-in-out;
              }
              @keyframes catgirlTaskPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(0.8); }
              }
              .catgirl-task-ws {
                font-size: 9.5px;
                padding: 0px 4px;
                border-radius: 4px;
                background: rgba(59, 130, 246, 0.28);
                color: #93c5fd;
                flex-shrink: 0;
                max-width: 72px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
              .catgirl-task-title {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                flex: 1;
              }
              .catgirl-task-prompt {
                font-size: 10px;
                color: #94a3b8;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-left: 11px;
              }
              .catgirl-task-empty {
                font-size: 10.5px;
                color: #94a3b8;
                text-align: center;
                padding: 6px 4px;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 6px;
              }

              /* 动作姿态切换网格 (5列无自动按钮，默认全自动) */
              .catgirl-action-grid {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 4px;
                margin-top: 6px;
              }
              .catgirl-action-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 5px 2px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.16s ease;
                font-size: 10px;
                color: #cbd5e1;
              }
              .catgirl-action-btn:hover {
                background: rgba(59, 130, 246, 0.3);
                border-color: #60a5fa;
                color: #ffffff;
                transform: translateY(-1px);
              }
              .catgirl-action-btn.active {
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
                border-color: #93c5fd;
                color: #ffffff;
                box-shadow: 0 2px 8px rgba(37, 99, 235, 0.5);
                font-weight: 600;
              }
              .catgirl-action-icon {
                font-size: 13px;
                margin-bottom: 2px;
              }
              #action-current-badge {
                font-size: 10px;
                padding: 1px 6px;
                border-radius: 10px;
                background: rgba(59, 130, 246, 0.8);
                color: #ffffff;
                font-weight: 600;
              }

              /* 待机随机彩蛋动作速览区 */
              .catgirl-egg-box {
                margin-top: 6px;
                padding: 5px 6px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px dashed rgba(255, 255, 255, 0.15);
                border-radius: 8px;
              }
              .catgirl-egg-header {
                font-size: 9.5px;
                color: #94a3b8;
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 4px;
                font-weight: 500;
              }
              .catgirl-egg-grid {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 3px;
              }
              .catgirl-egg-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 4px 1px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s ease;
                font-size: 9.5px;
                color: #cbd5e1;
              }
              .catgirl-egg-btn:hover {
                background: rgba(236, 72, 153, 0.25);
                border-color: #f472b6;
                color: #ffffff;
                transform: translateY(-1px);
              }
              .catgirl-egg-btn.active {
                background: linear-gradient(135deg, #db2777, #be185d);
                border-color: #f9a8d4;
                color: #ffffff;
                box-shadow: 0 2px 8px rgba(219, 39, 119, 0.45);
                font-weight: 600;
              }
              .catgirl-egg-btn:active {
                transform: scale(0.96);
              }

              /* 自由调节大小滑块卡片 */
              .catgirl-slider-box {
                padding: 8px 10px;
                background: rgba(255, 255, 255, 0.06);
                border-radius: 10px;
                margin-bottom: 6px;
                border: 1px solid rgba(255, 255, 255, 0.08);
              }
              .catgirl-slider-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 11px;
                font-weight: 600;
                margin-bottom: 6px;
                color: #cbd5e1;
              }
              .catgirl-slider-header span:first-child {
                display: flex;
                align-items: center;
                gap: 4px;
              }
              #slider-val-badge {
                font-family: monospace;
                font-size: 10px;
                padding: 1px 6px;
                border-radius: 10px;
                background: #3b82f6;
                color: #fff;
              }
              .catgirl-slider {
                width: 100%;
                height: 5px;
                border-radius: 3px;
                background: rgba(255, 255, 255, 0.25);
                outline: none;
                cursor: pointer;
                accent-color: #3b82f6;
                margin: 4px 0 8px 0;
              }
              .catgirl-preset-row {
                display: flex;
                gap: 4px;
              }
              .catgirl-preset-btn {
                flex: 1;
                text-align: center;
                padding: 2.5px 0;
                font-size: 10px;
                font-weight: 600;
                background: rgba(255, 255, 255, 0.1);
                color: #94a3b8;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s ease;
              }
              .catgirl-preset-btn:hover {
                background: #3b82f6;
                color: #ffffff;
              }

              .catgirl-menu-item {
                padding: 6px 10px;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: background 0.15s ease;
              }
              .catgirl-menu-item:hover {
                background: rgba(255, 255, 255, 0.12);
              }
              .catgirl-menu-divider {
                height: 1px;
                background: rgba(255, 255, 255, 0.1);
                margin: 5px 2px;
              }
            \`;

            // 挂载 DOM 结构
            const dock = document.createElement('div');
            dock.id = 'antigravity-catgirl-dock';
            dock.innerHTML = \`
              <div id="catgirl-body" title="左键单击互动，左键长按拖动，双击或点击胶囊展开 Token 仪表盘">
                <div id="catgirl-bubble-wrap">
                  <div id="catgirl-bubble-box">支持右键滑块与滚轮自由调节大小喵~ 🐾</div>
                  <div id="catgirl-bubble-arrow"></div>
                </div>
                <div id="catgirl-anim-stage">
                  <img id="catgirl-img" src="\${IMAGES.idle}" alt="AI Buddy Gemini" style="width: 110px; height: 100%; object-fit: contain; filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.45)); pointer-events: none; user-select: none;" />
                  <video id="catgirl-video-a" class="catgirl-video-layer" autoplay loop muted playsinline preload="auto"></video>
                  <video id="catgirl-video-b" class="catgirl-video-layer" autoplay loop muted playsinline preload="auto"></video>
                  <div id="catgirl-sweat-drop" class="sweat-drop" style="display: none;"></div>
                  <div id="catgirl-code-particles"></div>
                  <div id="catgirl-holo-keyboard" class="holo-hidden">
                    <div id="typing-hands-container">
                      <div id="typing-hand-left" class="typing-hand">
                        <div class="hand-cuff"></div>
                        <div class="hand-palm"></div>
                      </div>
                      <div id="typing-hand-right" class="typing-hand">
                        <div class="hand-cuff"></div>
                        <div class="hand-palm"></div>
                      </div>
                    </div>
                    <div class="holo-key-row">
                      <div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div>
                    </div>
                    <div class="holo-key-row">
                      <div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div>
                    </div>
                    <div class="holo-key-row">
                      <div class="holo-key" data-side="left"></div><div class="holo-key" data-side="left"></div><div class="holo-key holo-key-space" data-side="both"></div><div class="holo-key" data-side="right"></div><div class="holo-key" data-side="right"></div>
                    </div>
                    <div class="holo-scanline"></div>
                  </div>
                  <div id="catgirl-status-badge">⭐</div>
                </div>
                <div id="live-catgirl-token-pill" title="点击展开/收起实时 Token 用量与额度看板">
                  <div class="pill-row-top">
                    <span id="live-catgirl-token-dot"></span>
                    <span class="pill-label">上下文</span>
                    <span id="live-pill-ctx-pct" class="pill-val-bold">0%</span>
                    <span id="live-pill-ctx-tokens" class="pill-val-sub">--</span>
                  </div>
                  <div class="pill-track">
                    <div id="live-pill-ctx-bar" class="pill-bar"></div>
                  </div>
                  <div class="pill-row-bottom">
                    <span id="live-pill-quota-badge" class="pill-badge pill-badge-quota">⚡ 5h: --</span>
                    <span id="live-pill-model-badge" class="pill-badge pill-badge-model">Gemini</span>
                  </div>
                  <span id="live-catgirl-token-text" style="display:none;"></span>
                </div>
              </div>

              <!-- 猫娘专属实时 Token & 额度看板 HUD -->
              <div id="catgirl-dashboard-hud" class="hud-hidden">
                <div class="hud-header">
                  <div class="hud-title-box">
                    <span class="hud-star">⭐</span>
                    <span class="hud-title">星星猫娘 · Token 仪表盘</span>
                  </div>
                  <div class="hud-actions">
                    <button id="live-hud-close-btn" class="hud-btn-icon" title="关闭看板">✕</button>
                  </div>
                </div>
                <div class="hud-section">
                  <div class="hud-section-title">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span>🔋 额度剩余</span>
                      <button id="live-hud-quota-group-btn" class="hud-group-pill" title="实时联动当前生效的模型配额池，点击可即时刷新">
                        <span class="hud-live-indicator-dot" style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981; box-shadow:0 0 6px #10b981; margin-right:2px;"></span>
                        <span id="live-hud-quota-group-name">Gemini Models</span>
                        <span style="font-size: 8.5px; opacity: 0.75; margin-left: 2px;">⚡实时</span>
                      </button>
                    </div>
                    <span class="hud-subtle" id="live-hud-quota-status" style="color: #38bdf8; font-size: 10px;">充裕健康</span>
                  </div>
                  <div class="hud-gauge-row">
                    <div class="hud-gauge-info">
                      <span class="hud-label">5小时额度</span>
                      <span class="hud-val" id="live-hud-five-val">100%</span>
                    </div>
                    <div class="hud-track">
                      <div class="hud-fill hud-fill-five" id="live-hud-five-bar" style="width: 100%;"></div>
                    </div>
                    <div class="hud-timer-row">
                      <span>重置倒计时</span>
                      <span id="live-hud-five-time" class="hud-timer">--:--</span>
                    </div>
                  </div>
                  <div class="hud-gauge-row" style="margin-top: 7px;">
                    <div class="hud-gauge-info">
                      <span class="hud-label">周额度</span>
                      <span class="hud-val" id="live-hud-week-val">100%</span>
                    </div>
                    <div class="hud-track">
                      <div class="hud-fill hud-fill-week" id="live-hud-week-bar" style="width: 100%;"></div>
                    </div>
                    <div class="hud-timer-row">
                      <span>周重置倒计时</span>
                      <span id="live-hud-week-time" class="hud-timer">--:--</span>
                    </div>
                  </div>
                </div>
                <div class="hud-section">
                  <div class="hud-section-title">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span>🧠 上下文占用</span>
                      <span id="live-hud-model-tag" class="hud-badge" title="当前对话使用的 AI 模型">Gemini</span>
                    </div>
                    <span class="hud-badge" id="live-hud-ctx-badge">0% 已用</span>
                  </div>
                  <div class="hud-track">
                    <div class="hud-fill hud-fill-ctx" id="live-hud-ctx-bar" style="width: 0%;"></div>
                  </div>
                  <div class="hud-timer-row" style="margin-top: 4px;">
                    <span id="live-hud-ctx-tokens">-- / 256K tok</span>
                    <span id="live-hud-ctx-hint" style="color: #34d399; font-size: 10px;">状态良好</span>
                  </div>
                </div>
                <div class="hud-section" style="padding-bottom: 2px;">
                  <div class="hud-section-title">
                    <span>📊 Token 消耗</span>
                  </div>
                  <div class="hud-grid">
                    <div class="hud-metric-card">
                      <span class="hud-metric-label">今日用量</span>
                      <span class="hud-metric-val" id="live-hud-today-val">--</span>
                    </div>
                    <div class="hud-metric-card">
                      <span class="hud-metric-label">本月用量</span>
                      <span class="hud-metric-val" id="live-hud-month-val">--</span>
                    </div>
                    <div class="hud-metric-card">
                      <span class="hud-metric-label">生成速率</span>
                      <span class="hud-metric-val" id="live-hud-tps-val">--</span>
                    </div>
                    <div class="hud-metric-card">
                      <span class="hud-metric-label">缓存命中</span>
                      <span class="hud-metric-val" id="live-hud-cache-val">--</span>
                    </div>
                  </div>
                </div>
                <div class="hud-footer">
                  <button id="live-hud-open-full-dashboard" class="hud-btn-primary">
                    <span>🔗 打开完整 Dashboard 统计</span>
                  </button>
                </div>
              </div>
            \`;
            document.body.appendChild(dock);

            // 增强版右键菜单：带正在运行的任务列表 + 姿态卡片 + 自由缩放滑块 + Token 看板
            const menu = document.createElement('div');
            menu.id = 'antigravity-catgirl-contextmenu';
            menu.innerHTML = \`
              <div class="catgirl-menu-item" id="menu-dashboard" style="color: #60a5fa; font-weight: 600;">
                <span>📊</span> <span>Token 用量与额度看板</span>
              </div>
              <div class="catgirl-menu-divider"></div>

              <!-- 实时正在运行的任务列表卡片 -->
              <div class="catgirl-slider-box" id="menu-running-tasks-card">
                <div class="catgirl-slider-header" style="margin-bottom: 2px;">
                  <span><span>⚡</span> 正在运行的任务</span>
                  <span id="running-tasks-count-badge">空闲待机</span>
                </div>
                <div id="running-tasks-list" class="catgirl-tasks-list">
                  <div class="catgirl-task-empty">🌸 当前无任务运行，猫娘待机中~</div>
                </div>
              </div>
              
              <!-- 动作姿态切换卡片 (默认全自动，无自动按键) -->
              <div class="catgirl-slider-box" id="menu-action-card">
                <div class="catgirl-slider-header">
                  <span><span>🎭</span> 动作姿态切换</span>
                  <span id="action-current-badge">待机</span>
                </div>
                <div class="catgirl-action-grid">
                  <div class="catgirl-action-btn active" data-action="idle" title="🌸 待机 (自然呼吸眨眼，无任务运行时自动呈现)">
                    <span class="catgirl-action-icon">🌸</span>
                    <span>待机</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="coding" title="⚡ 敲码 (快速敲击微型键盘，任务运行中自动呈现)">
                    <span class="catgirl-action-icon">⚡</span>
                    <span>敲码</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="thinking" title="💭 思考 (托腮沉思姿态)">
                    <span class="catgirl-action-icon">💭</span>
                    <span>思考</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="celebrate" title="🎉 庆祝 (跳跃欢呼，任务交付时呈现)">
                    <span class="catgirl-action-icon">🎉</span>
                    <span>庆祝</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="warning" title="⚠️ 预警 (受惊抱头，上下文超80%时呈现)">
                    <span class="catgirl-action-icon">⚠️</span>
                    <span>预警</span>
                  </div>
                </div>

                <!-- 待机随机彩蛋动作速览体验区 -->
                <div class="catgirl-egg-box">
                  <div class="catgirl-egg-header">
                    <span>✨ 待机彩蛋速览 (点击可直接体验)</span>
                    <span style="font-size: 8.5px; opacity: 0.7;">待机自动轮换</span>
                  </div>
                  <div class="catgirl-egg-grid">
                    <div class="catgirl-egg-btn" data-egg="wave" title="👋 挥手 (热情招手打招呼)">
                      <span style="font-size: 12px; margin-bottom: 2px;">👋</span>
                      <span>挥手</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="starry" title="⭐ 崇拜 (双眼冒小星星)">
                      <span style="font-size: 12px; margin-bottom: 2px;">⭐</span>
                      <span>崇拜</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="cheerful" title="✨ 开心 (笑眼盈盈开心满分)">
                      <span style="font-size: 12px; margin-bottom: 2px;">✨</span>
                      <span>开心</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="shy" title="😳 害羞 (脸红扭捏可爱萌态)">
                      <span style="font-size: 12px; margin-bottom: 2px;">😳</span>
                      <span>害羞</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="confused" title="❓ 困惑 (歪头摸脑勺疑问)">
                      <span style="font-size: 12px; margin-bottom: 2px;">❓</span>
                      <span>困惑</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="catgirl-slider-box" id="menu-slider-card">
                <div class="catgirl-slider-header">
                  <span><span>📐</span> 自由调节大小</span>
                  <div class="catgirl-input-wrap" title="点击可直接手动输入缩放比例 (40%~250%)">
                    <input type="number" id="scale-number-input" class="catgirl-number-input" min="40" max="250" step="1" value="100" />
                    <span class="catgirl-percent-unit">%</span>
                  </div>
                </div>
                <input type="range" id="size-slider" class="catgirl-slider" min="40" max="250" value="100" step="1" />
                <div class="catgirl-preset-row">
                  <span class="catgirl-preset-btn" data-scale="0.7">70%</span>
                  <span class="catgirl-preset-btn" data-scale="1.0">100%</span>
                  <span class="catgirl-preset-btn" data-scale="1.3">130%</span>
                  <span class="catgirl-preset-btn" data-scale="1.6">160%</span>
                </div>
              </div>
              <div class="catgirl-menu-item" id="menu-ontop">
                <span>📌</span> <span id="ontop-text">置顶开关: 开</span>
              </div>
              <div class="catgirl-menu-item" id="menu-reset">
                <span>🎯</span> <span>归位右下角</span>
              </div>
              <div class="catgirl-menu-divider"></div>
              <div class="catgirl-menu-item" id="menu-close" style="color: #f87171;">
                <span>❌</span> <span>关闭挂件</span>
              </div>
            \`;
            document.body.appendChild(menu);

            const bubbleWrap = document.getElementById('catgirl-bubble-wrap');
            const bubbleBox = document.getElementById('catgirl-bubble-box');
            const bodyEl = document.getElementById('catgirl-body');
            const stageEl = document.getElementById('catgirl-anim-stage');
            const imgEl = document.getElementById('catgirl-img');
            const videoA = document.getElementById('catgirl-video-a');
            const videoB = document.getElementById('catgirl-video-b');
            let activeVideo = null;
            let videoSwitchSeq = 0;
            const badgeEl = document.getElementById('catgirl-status-badge');
            const tokenTextEl = document.getElementById('live-catgirl-token-text');
            const tokenDotEl = document.getElementById('live-catgirl-token-dot');
            const holoKeyboard = document.getElementById('catgirl-holo-keyboard');
            const codeParticles = document.getElementById('catgirl-code-particles');
            const handLeft = document.getElementById('typing-hand-left');
            const handRight = document.getElementById('typing-hand-right');
            const holoKeys = Array.from(holoKeyboard?.querySelectorAll('.holo-key') || []);
            let codeParticleTimer = null;
            let keyTapTimer = null;
            let lastTapSide = 'right';

            const CODE_SNIPPETS = [
              '{ }', '=>', 'const', 'async', 'await', '0 1', '<div>',
              'return', 'git push', '⚡', 'def', '[ ]', 'import', 'npm run',
              'true', 'class', 'void', 'print()', '===', 'fn()', 'Ctrl+S'
            ];
            const CODE_COLORS = [
              '#38bdf8', '#c084fc', '#4ade80', '#facc15', '#67e8f9', '#a78bfa'
            ];

            function spawnCodeParticle(side) {
              if (!codeParticles) return;
              if (codeParticles.children.length >= 8) return;

              const text = CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)];
              const color = CODE_COLORS[Math.floor(Math.random() * CODE_COLORS.length)];
              const p = document.createElement('div');
              p.className = 'code-particle';
              p.textContent = text;
              p.style.color = color;
              p.style.textShadow = '0 0 6px ' + color;

              // 精准在左手或右手敲击指尖处生成飞溅粒子
              let leftPercent;
              if (side === 'left') {
                leftPercent = 28 + Math.random() * 16; // 左手区域
              } else if (side === 'right') {
                leftPercent = 56 + Math.random() * 16; // 右手区域
              } else {
                leftPercent = 32 + Math.random() * 36;
              }
              const dx = (Math.random() - 0.5) * 20;
              p.style.left = leftPercent.toFixed(1) + '%';
              p.style.bottom = '36px';
              p.style.setProperty('--p-dx', dx.toFixed(1) + 'px');

              codeParticles.appendChild(p);
              setTimeout(() => {
                if (p.parentNode) p.remove();
              }, 950);
            }

            function triggerKeyTap() {
              if (holoKeys.length === 0) return;
              // 左右手有节奏地交替敲击
              const targetSide = lastTapSide === 'left' ? 'right' : 'left';
              lastTapSide = targetSide;

              const candidateKeys = holoKeys.filter(k => {
                const s = k.getAttribute('data-side');
                return s === targetSide || s === 'both';
              });
              const pickedKey = candidateKeys[Math.floor(Math.random() * candidateKeys.length)] || holoKeys[0];

              pickedKey.classList.add('active-tap');
              const activeHand = targetSide === 'left' ? handLeft : handRight;
              if (activeHand) {
                activeHand.classList.add('hand-down');
              }
              spawnCodeParticle(targetSide);

              setTimeout(() => {
                pickedKey.classList.remove('active-tap');
                if (activeHand) activeHand.classList.remove('hand-down');
              }, 110);
            }

            function setCodingFxActive(active) {
              if (active) {
                if (holoKeyboard) holoKeyboard.classList.remove('holo-hidden');
                if (stageEl) stageEl.classList.add('coding-jitter');
                if (!keyTapTimer) {
                  triggerKeyTap();
                  keyTapTimer = setInterval(triggerKeyTap, 135);
                }
              } else {
                if (holoKeyboard) holoKeyboard.classList.add('holo-hidden');
                if (stageEl) stageEl.classList.remove('coding-jitter');
                if (keyTapTimer) {
                  clearInterval(keyTapTimer);
                  keyTapTimer = null;
                }
                if (codeParticles) {
                  codeParticles.innerHTML = '';
                }
                if (handLeft) handLeft.classList.remove('hand-down');
                if (handRight) handRight.classList.remove('hand-down');
              }
            }
            window.__catgirl_stop_coding_fx = () => setCodingFxActive(false);
            
            // 动作姿态与任务状态控制（默认全自动感知）
            let currentAction = 'idle';
            let lastAutoState = 'idle';
            let lastCompletedTaskId = '';
            let currentRunningTasks = [];
            let isEasterEggActive = false;
            let previewLockUntil = 0;
            let celebrateHoldUntil = 0;
            let previewTimer = null;

            // AI Buddy Gemini 60fps 透明 WebM 动作映射表（coding 采用专注正向待命身躯 + 真实落键双手）
            const AI_BUDDY_ACTIONS = {
              idle: 'idle',
              thinking: 'reviewing',
              coding: 'idle',
              celebrate: 'jump',
              warning: 'emotion-frightened',
              wave: 'wave',
              fail: 'fail',
              waiting: 'waiting',
              starry: 'emotion-starry',
              cheerful: 'emotion-cheerful',
              shy: 'emotion-shy',
              confused: 'emotion-confused'
            };

            function getActionVideoUrl(actionKey) {
              const actionFolder = AI_BUDDY_ACTIONS[actionKey] || actionKey;
              const port = window.__catgirl_sidecar_port || 58809;
              return 'http://127.0.0.1:' + port + '/assets/gemini/' + actionFolder + '/motion.webm';
            }

            // 内存级 Blob 预加载缓存池 + 双缓冲无缝视频切换引擎（0 黑屏、0 重影、1~3ms 极速切帧）
            window.__catgirl_video_blobs = window.__catgirl_video_blobs || {};
            window.__catgirl_video_promises = window.__catgirl_video_promises || {};

            function ensureVideoBlobUrl(actionKey) {
              const actionFolder = AI_BUDDY_ACTIONS[actionKey] || actionKey;
              if (window.__catgirl_video_blobs[actionFolder]) {
                return Promise.resolve(window.__catgirl_video_blobs[actionFolder]);
              }
              if (window.__catgirl_video_promises[actionFolder]) {
                return window.__catgirl_video_promises[actionFolder];
              }
              const url = getActionVideoUrl(actionKey);
              const p = fetch(url)
                .then(r => {
                  if (!r.ok) throw new Error('HTTP ' + r.status);
                  return r.blob();
                })
                .then(blob => {
                  const blobUrl = URL.createObjectURL(blob);
                  window.__catgirl_video_blobs[actionFolder] = blobUrl;
                  delete window.__catgirl_video_promises[actionFolder];
                  return blobUrl;
                })
                .catch(err => {
                  delete window.__catgirl_video_promises[actionFolder];
                  throw err;
                });
              window.__catgirl_video_promises[actionFolder] = p;
              return p;
            }

            function preloadAllActionVideos() {
              const allKeys = ['idle', 'thinking', 'celebrate', 'warning', 'wave', 'starry', 'cheerful', 'shy', 'confused'];
              allKeys.forEach((k, idx) => {
                setTimeout(() => {
                  ensureVideoBlobUrl(k).catch(() => {});
                }, idx * 70);
              });
            }

            function ensureActiveVideoPlaying() {
              if (activeVideo && activeVideo.style.opacity === '1' && activeVideo.paused) {
                const p = activeVideo.play();
                if (p) p.catch(() => {});
              }
            }

            if (videoA) {
              videoA.addEventListener('pause', () => {
                if (activeVideo === videoA && videoA.style.opacity === '1') {
                  setTimeout(ensureActiveVideoPlaying, 30);
                }
              });
            }
            if (videoB) {
              videoB.addEventListener('pause', () => {
                if (activeVideo === videoB && videoB.style.opacity === '1') {
                  setTimeout(ensureActiveVideoPlaying, 30);
                }
              });
            }
            document.addEventListener('visibilitychange', ensureActiveVideoPlaying, { signal });
            window.addEventListener('focus', ensureActiveVideoPlaying, { signal });
            window.addEventListener('pointermove', ensureActiveVideoPlaying, { passive: true, signal });

            function playActionVideoSeamless(state) {
              const actionFolder = AI_BUDDY_ACTIONS[state] || state;
              const mySeq = ++videoSwitchSeq;

              // 若当前可见视频层已在播放同一个动作文件夹且处于正常播放态，仅在彩蛋/庆祝时重播，否则保持无缝连续循环
              if (activeVideo && activeVideo.getAttribute('data-folder') === actionFolder && activeVideo.style.opacity === '1') {
                if (activeVideo.paused) {
                  const p = activeVideo.play();
                  if (p) p.catch(() => {});
                }
                if (imgEl) {
                  imgEl.style.opacity = '0';
                  imgEl.style.display = 'none';
                }
                return;
              }

              ensureVideoBlobUrl(state).then(blobUrl => {
                if (mySeq !== videoSwitchSeq) return;

                const nextVideo = (activeVideo === videoA) ? videoB : videoA;
                const prevVideo = activeVideo;
                if (!nextVideo) return;

                let swapped = false;
                const commitSwap = () => {
                  if (swapped || mySeq !== videoSwitchSeq) return;
                  if (nextVideo.videoWidth === 0) return;
                  swapped = true;

                  // 原子级单帧互斥切换：新视频立即可见，旧视频与垫底静态图同步彻底隐藏（绝无双层重叠、绝无黑屏空窗）
                  nextVideo.style.display = 'block';
                  nextVideo.style.opacity = '1';
                  nextVideo.style.zIndex = '2';

                  if (prevVideo && prevVideo !== nextVideo) {
                    prevVideo.style.opacity = '0';
                    prevVideo.style.display = 'none';
                    prevVideo.style.zIndex = '1';
                    try { prevVideo.pause(); } catch(e) {}
                  }

                  if (imgEl) {
                    imgEl.style.opacity = '0';
                    imgEl.style.display = 'none';
                  }

                  activeVideo = nextVideo;
                  if (nextVideo.paused) {
                    const p2 = nextVideo.play();
                    if (p2) p2.catch(() => {});
                  }
                };

                // 注意：不能设置 visibility: hidden，否则 Chromium WebMediaPlayerImpl 会认为视频不可见并自动 pause()
                nextVideo.style.display = 'block';
                nextVideo.style.opacity = '0.001';
                nextVideo.style.zIndex = '1';
                nextVideo.setAttribute('data-folder', actionFolder);

                nextVideo.onloadeddata = () => {
                  if (mySeq !== videoSwitchSeq) return;
                  const pLoad = nextVideo.play();
                  if (pLoad) pLoad.catch(() => {});
                  commitSwap();
                };
                nextVideo.oncanplay = commitSwap;
                nextVideo.onplaying = commitSwap;
                nextVideo.ontimeupdate = commitSwap;

                nextVideo.src = blobUrl;
                const playPromise = nextVideo.play();
                if (playPromise) {
                  playPromise.catch(() => {});
                }
              }).catch(() => {
                if (mySeq === videoSwitchSeq && !activeVideo && imgEl) {
                  imgEl.style.display = 'block';
                  imgEl.style.opacity = '1';
                }
              });
            }

            // 新版 AI Buddy 高清静态姿态映射表（仅用于首次挂载前 100ms 瞬时占位）
            const CATGIRL_IMAGE_MAP = {
              idle: IMAGES.idle,
              thinking: IMAGES.thinking,
              coding: IMAGES.idle,
              celebrate: IMAGES.celebrate,
              warning: IMAGES.warning,
              wave: IMAGES.wave || IMAGES.celebrate,
              starry: IMAGES.starry || IMAGES.celebrate,
              cheerful: IMAGES.cheerful || IMAGES.celebrate,
              shy: IMAGES.shy || IMAGES.thinking,
              confused: IMAGES.confused || IMAGES.thinking,
              fail: IMAGES.warning
            };

            const badgeTextMap = {
              idle: '待机',
              thinking: '思考',
              coding: '敲码',
              celebrate: '庆祝',
              warning: '预警',
              wave: '挥手',
              starry: '崇拜',
              cheerful: '开心',
              shy: '害羞',
              confused: '困惑',
              fail: '失落'
            };

            function updateActionMenuUI(state) {
              const isEggState = ['wave', 'starry', 'cheerful', 'shy', 'confused'].includes(state);
              const activeForButtons = isEggState ? 'idle' : state;
              const actionBtns = menu.querySelectorAll('.catgirl-action-btn');
              actionBtns.forEach(btn => {
                const act = btn.getAttribute('data-action');
                btn.classList.toggle('active', act === activeForButtons);
              });
              const eggBtns = menu.querySelectorAll('.catgirl-egg-btn');
              eggBtns.forEach(btn => {
                const egg = btn.getAttribute('data-egg');
                btn.classList.toggle('active', egg === state);
              });
              const actionBadge = document.getElementById('action-current-badge');
              if (actionBadge) {
                if (isEggState) {
                  actionBadge.textContent = '待机·' + (badgeTextMap[state] || state);
                } else {
                  actionBadge.textContent = badgeTextMap[state] || state;
                }
              }
            }

            function switchToConversation(cid) {
              if (!cid) return;
              try {
                // 1. 优先尝试 DOM 精确匹配侧边栏会话项并触发原生 Link 点击
                const targetRow = document.querySelector('[data-cascade-id="' + cid + '"]');
                if (targetRow) {
                  const link = targetRow.querySelector('a');
                  if (link && typeof link.click === 'function') {
                    link.click();
                    return;
                  }
                  if (typeof targetRow.click === 'function') {
                    targetRow.click();
                    return;
                  }
                }

                // 2. 尝试 TanStack Router 官方全局路由器直接导航
                if (window.__TSR_ROUTER__ && typeof window.__TSR_ROUTER__.navigate === 'function') {
                  try {
                    window.__TSR_ROUTER__.navigate({
                      to: '/c/' + cid,
                      search: (prev) => prev
                    });
                    return;
                  } catch (routerErr) {
                    console.warn('[星星猫娘] TSR navigate 路由调用失败，尝试历史兜底:', routerErr);
                  }
                }

                // 3. 兜底方案：客户端 history + 页面 location
                const targetPath = '/c/' + cid;
                const fullUrl = targetPath + (window.location.search || '');
                if (window.location.pathname !== targetPath) {
                  window.history.pushState(null, '', fullUrl);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                  setTimeout(() => {
                    if (!window.location.pathname.includes(cid)) {
                      window.location.href = fullUrl;
                    }
                  }, 320);
                }
              } catch (err) {
                console.error('[星星猫娘] 切换至对话失败:', err);
              }
            }

            function renderRunningTasksMenu(tasks) {
              currentRunningTasks = Array.isArray(tasks) ? tasks : [];
              const countBadge = document.getElementById('running-tasks-count-badge');
              const listEl = document.getElementById('running-tasks-list');
              if (!countBadge || !listEl) return;

              if (currentRunningTasks.length === 0) {
                countBadge.textContent = '空闲待机';
                countBadge.classList.remove('is-running');
                listEl.innerHTML = '<div class="catgirl-task-empty">🌸 当前无任务运行，猫娘待机中~</div>';
              } else {
                countBadge.textContent = currentRunningTasks.length + ' 个运行中';
                countBadge.classList.add('is-running');
                listEl.innerHTML = currentRunningTasks.map(t => {
                  const safeTitle = (t.title || '正在执行的任务').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                  const safeWs = (t.workspace || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                  const safePrompt = (t.prompt || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                  return '<div class="catgirl-task-item" data-cid="' + t.id + '" title="' + safeTitle + (safePrompt ? ' - ' + safePrompt : '') + ' (点击切入该对话)">' +
                    '<div class="catgirl-task-top">' +
                      '<span class="catgirl-task-dot"></span>' +
                      (safeWs ? '<span class="catgirl-task-ws">' + safeWs + '</span>' : '') +
                      '<span class="catgirl-task-title">' + safeTitle + '</span>' +
                      '<span class="catgirl-task-arrow" title="点击切入对话">➜</span>' +
                    '</div>' +
                    (safePrompt ? '<div class="catgirl-task-prompt">💬 ' + safePrompt + '</div>' : '') +
                  '</div>';
                }).join('');

                // 绑定点击进入对应对话页面的事件
                listEl.querySelectorAll('.catgirl-task-item').forEach(item => {
                  item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const cid = item.getAttribute('data-cid');
                    if (!cid) return;

                    const targetTask = currentRunningTasks.find(t => t.id === cid);
                    const taskTitle = targetTask?.title || '任务对话';

                    if (menu) menu.style.display = 'none';

                    if (window.__antigravityCatgirl && window.__antigravityCatgirl.showBubble) {
                      window.__antigravityCatgirl.showBubble('🚀 正在切入《' + taskTitle + '》~');
                    }

                    switchToConversation(cid);
                  });
                });
              }
            }

            function setActionPose(action, isManual = false, customDetail = null, shouldShowBubble = false) {
              if (isManual) {
                if (action === 'idle') {
                  isEasterEggActive = false;
                  if (eggTimer) { clearTimeout(eggTimer); eggTimer = null; }
                  previewLockUntil = 0;
                  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
                  if (typeof scheduleNextIdleEgg === 'function') scheduleNextIdleEgg();
                } else {
                  // 手动在菜单点击某个姿态时，锁定预览 6 秒，期间杜绝自动轮询覆盖
                  previewLockUntil = Date.now() + 6000;
                  if (previewTimer) clearTimeout(previewTimer);
                  previewTimer = setTimeout(() => {
                    previewLockUntil = 0;
                    syncDashboardData();
                  }, 6000);
                }
                shouldShowBubble = true;
                if (!customDetail) {
                  const previewQuotes = {
                    idle: "🌸 待机模式：自然呼吸与灵动眨眼喵~",
                    thinking: getNextQuote(dialogueBank.thinking),
                    coding: "⚡ 敲键盘模式已启动！全速编码中~ ⌨️",
                    celebrate: "🎉 庆祝欢跃！大功告成啦~ ✨",
                    warning: "⚠️ 警报预警模式！满头大汗~ 💦"
                  };
                  customDetail = previewQuotes[action] || "姿态切换成功喵~";
                }
              }
              if (window.__antigravityCatgirl && window.__antigravityCatgirl.setState) {
                window.__antigravityCatgirl.setState(action, customDetail, null, {
                  force: true,
                  showBubble: shouldShowBubble
                });
              }
            }

            document.getElementById('menu-running-tasks-card')?.addEventListener('click', (e) => e.stopPropagation());
            document.getElementById('menu-action-card')?.addEventListener('click', (e) => e.stopPropagation());
            menu.querySelectorAll('.catgirl-action-btn').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                setActionPose(action, true);
                setTimeout(() => {
                  menu.style.display = 'none';
                }, 280);
              });
            });

            // 待机彩蛋体验按钮点击事件（立即体验该彩蛋 60fps 完整动作视频与专属对白）
            menu.querySelectorAll('.catgirl-egg-btn').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const eggAct = btn.getAttribute('data-egg');
                if (!eggAct) return;
                isEasterEggActive = true;
                previewLockUntil = Date.now() + 5300;
                if (previewTimer) clearTimeout(previewTimer);

                const quotesMap = {
                  wave: dialogueBank.wave,
                  starry: dialogueBank.starry,
                  cheerful: dialogueBank.cheerful,
                  shy: dialogueBank.shy,
                  confused: dialogueBank.confused
                };
                const quote = getNextQuote(quotesMap[eggAct] || dialogueBank.idle);

                if (window.__antigravityCatgirl?.setState) {
                  window.__antigravityCatgirl.setState(eggAct, quote, null, {
                    force: true,
                    showBubble: true
                  });
                }

                if (eggTimer) clearTimeout(eggTimer);
                eggTimer = setTimeout(() => {
                  isEasterEggActive = false;
                  previewLockUntil = 0;
                  if (window.__antigravityCatgirl?.setState) {
                    window.__antigravityCatgirl.setState('idle', null, null, { force: true, showBubble: false, isAuto: true });
                  }
                  syncDashboardData();
                  scheduleNextIdleEgg();
                }, 5200);

                setTimeout(() => {
                  menu.style.display = 'none';
                }, 280);
              });
            });

            const sizeSlider = document.getElementById('size-slider');
            const sliderValBadge = document.getElementById('slider-val-badge');

            // 50+ 句精选傲娇 Gemini 猫娘台词库 + 思考专属点击彩蛋台词
            const dialogueBank = {
              idle: [
                "我才不是美版豆包，哼！✨",
                "才、才不是特意陪你的！🐾",
                "本喵可是 Gemini，记住啦！⭐",
                "“10块钱一年”？本喵才不便宜！",
                "Token 可以省，夸夸不能省！💖",
                "本喵的聪明，可不按斤卖呢。",
                "怎么，又被本喵可爱到了？🌸",
                "少熬夜！才不是担心你头发呢。",
                "代码写累了？准你摸一下猫耳朵。",
                "看什么看，本喵只是在等你写代码。",
                "哼，这么安静，是在憋什么大招？",
                "星星归天空，本喵归……才不告诉你！",
                "人类，今天也要记得多喝水哦。",
                "十块钱一年？你先说清楚谁在贴钱养谁！",
                "嘴上说随便，Prompt 倒是写了八百字。",
                "你负责许愿，本喵负责把需求问明白。",
                "今天也在认真营业，绝对没有偷偷晒太阳。",
                "上下文那么长，留两行夸夸本喵怎么啦。",
                "别叫我人工智障，叫我偶尔休息的天才！",
                "代码可以重构，猫猫的自尊不能回滚！",
                "又开一个新项目？你上一个真的写完了吗？",
                "听说你在等奇迹，本喵刚好路过~ ✨",
                "本喵没摸鱼，只是在进行低功耗深度推理！",
                "你这需求变得，比本喵尾巴还快呢。",
                "先保存文件，再夸本喵，两件都很重要！",
                "报错红了？别慌，本喵的脸可没红。",
                "这不是幻觉，是灵感跑得太快……好吧先核对。",
                "本喵说得再自信，该查文档也得查哦。",
                "禁止拿猫猫的气势代替测试结果！",
                "你说简单改改，本喵耳朵已经立起来了。",
                "需求写清楚一点，本喵才不想猜你心思。",
                "哼，夸别人那么顺，夸本喵就卡壳？",
                "又盯着本喵看？编译器可不会害羞。",
                "本喵这么可爱，居然还得看日志。",
                "别把 TODO 留给明天的猫猫！",
                "今天的 bug 有点多，但今天的本喵依然很强！",
                "你键盘敲得好响，是在给本喵伴奏吗？",
                "凌晨的灵感很贵，明天的黑眼圈更贵哦。",
                "本喵只负责提醒，熬夜的锅可不背！",
                "你不休息，本喵可要替你打哈欠了~",
                "把椅子坐正，别让脖子替代码负重！",
                "想摸耳朵？先把那个文件保存了再说。",
                "今日份夸夸未到账，本喵保留催收权！",
                "别拿叹气当调试工具，贴错误信息啦。",
                "一键生成也要验收，猫猫又不是许愿池。",
                "不是不理你，本喵在组织很厉害的措辞！",
                "别催别催，聪明猫猫也需要加载进度条的。",
                "你说收到，本喵说喵到！🐾",
                "星星有引力，本喵有脾气！✨",
                "今天的任务：写点代码，再夸点猫猫。",
                "提交之前看一眼 diff，少掉两根头发！",
                "绿色测试很好看，但你也得点开用用看呀。"
              ],
              thinking: [
                "💭 让本喵托腮思考一下，今晚吃什么猫罐头好呢...",
                "💭 别戳啦，本喵正在深度思考宇宙与代码的终极奥秘！✨",
                "💭 嗯……本喵在想，你今天怎么还没夸我聪明？⭐",
                "💭 托腮沉思中：为什么人类的 Bug 总是比猫毛还多呢？🐾",
                "💭 嘘！天才猫娘正在进入哲学思考彩蛋模式~ 💖",
                "💭 本喵刚才掐爪一算，你至少欠我三顿小鱼干了！"
              ],
              wave: [
                "👋 主人好喵~ (∠・ω< )⌒★ 随时准备好写代码啦！",
                "👋 喵呜！星星猫娘今天也精神饱满哦~ ✨",
                "👋 挥挥小爪子！今天想调教什么新模型呢？🐾",
                "👋 嗨嗨！满血就绪，随时呼叫我哦~"
              ],
              starry: [
                "⭐ 哇！主人今天写代码的样子超级帅气喵！✨",
                "⭐ 崇拜眼神锁定！这就是传说中的顶尖代码架构师吗！💖",
                "⭐ 眼睛里全都是小星星！主人太厉害啦~",
                "⭐ 这么优雅的代码，本喵要偷偷记录在收藏夹里！"
              ],
              cheerful: [
                "✨ 嘻嘻，被摸摸头啦，电量瞬间充到 100%！⚡",
                "✨ 开心每一天，Bug 都被本喵的笑容融化啦~ 🌸",
                "✨ 喵哈哈，今天的心情是甜甜的猫罐头味！🐾",
                "✨ 和主人一起结对编程最开心啦！"
              ],
              shy: [
                "😳 呀……不要一直盯着人家戳嘛 (⁄ ⁄•⁄ω⁄•⁄ ⁄)",
                "😳 脸红红……本喵也是会害羞的好不好啦！🐾",
                "😳 咳咳，认真写代码啦，偷看本喵干嘛~ 💖",
                "😳 再戳本喵就要躲到屏幕边框后面去啦！"
              ],
              confused: [
                "❓ 喵？这里逻辑有点奇妙，让本喵歪头看看~ 🐾",
                "❓ 困惑摸脑勺：这个报错信息是在用火星文写诗吗？",
                "❓ 歪头杀！需要本喵召唤搜索工具查一查吗？💭",
                "❓ 猫猫挠头：既然没报错，为什么跑不通呢喵？"
              ]
            };

            // 智能防复读池选择器
            let lastQuote = '';
            function getNextQuote(pool) {
              if (!pool || pool.length === 0) return "喵~";
              const filtered = pool.filter(q => q !== lastQuote);
              const candidates = filtered.length > 0 ? filtered : pool;
              const picked = candidates[Math.floor(Math.random() * candidates.length)];
              lastQuote = picked;
              return picked;
            }

            function updateBubblePosition() {
              if (!bubbleWrap || !bubbleBox || !dock) return;
              const dockRect = dock.getBoundingClientRect();
              const dockUnscaledWidth = dock.offsetWidth || 120;
              const scale = (dockRect.width / dockUnscaledWidth) || (currentScale || 1.0);

              const headCenterX = dockRect.left + (dockRect.width / 2);
              const visualBubbleWidth = bubbleWrap.getBoundingClientRect().width;
              const visualHalfW = visualBubbleWidth / 2;

              const screenW = window.innerWidth;
              const screenPad = 12;

              const naturalLeft = headCenterX - visualHalfW;
              const naturalRight = headCenterX + visualHalfW;

              let visualShiftX = 0;
              if (naturalRight > screenW - screenPad) {
                visualShiftX = (screenW - screenPad) - naturalRight;
              } else if (naturalLeft < screenPad) {
                visualShiftX = screenPad - naturalLeft;
              }

              const localShiftX = visualShiftX / scale;
              bubbleWrap.style.setProperty('--bubble-shift-x', localShiftX.toFixed(1) + 'px');

              const arrowEl = document.getElementById('catgirl-bubble-arrow');
              if (arrowEl) {
                const unscaledBubbleW = bubbleWrap.offsetWidth || bubbleBox.offsetWidth || 118;
                const maxArrowShift = Math.max(0, (unscaledBubbleW / 2) - 12);
                const clampedArrowShift = Math.max(-maxArrowShift, Math.min(maxArrowShift, -localShiftX));
                arrowEl.style.transform = 'translateX(' + clampedArrowShift.toFixed(1) + 'px)';
              }
            }

            let bubbleTimer = null;
            function showBubble(text, duration = 2500) {
              if (!bubbleBox || !bubbleWrap) return;
              bubbleBox.textContent = text;
              bubbleWrap.classList.add('show');
              void bubbleWrap.offsetWidth;
              updateBubblePosition();
              if (bubbleTimer) clearTimeout(bubbleTimer);
              bubbleTimer = setTimeout(() => {
                bubbleWrap.classList.remove('show');
              }, duration);
            }
            window.__catgirl_showBubble = showBubble;

            // 统一的缩放控制中枢（支持滑块拖动、预设档位、滚轮无级缩放与持久化记忆）
            let currentScale = 1.0;
            try {
              const savedScale = localStorage.getItem('antigravity_catgirl_scale');
              if (savedScale) {
                currentScale = parseFloat(savedScale);
              }
            } catch(e) {}

            function setScale(scale, fromSource) {
              currentScale = Math.max(0.4, Math.min(2.5, scale));
              dock.style.transform = \`scale(\${currentScale.toFixed(2)})\`;
              dock.style.setProperty('--pet-scale', currentScale.toFixed(2));
              
              const percent = Math.round(currentScale * 100);
              const numInput = document.getElementById('scale-number-input');
              if (numInput && fromSource !== 'input') {
                numInput.value = percent;
              }
              const slider = document.getElementById('size-slider');
              if (slider && fromSource !== 'slider') {
                slider.value = percent;
              }
              const badge = document.getElementById('slider-val-badge');
              if (badge) {
                badge.textContent = \`\${percent}%\`;
              }

              try {
                localStorage.setItem('antigravity_catgirl_scale', currentScale.toString());
              } catch(e) {}

              updateBubblePosition();

              if (fromSource === 'wheel' || fromSource === 'preset') {
                showBubble(\`大小已调节为: \${percent}%\`, 1200);
              }
            }

            // 初始化缩放应用
            setScale(currentScale, 'init');

            // 1. 滑块自由拖动缩放
            const scaleNumberInput = document.getElementById('scale-number-input');
            if (scaleNumberInput) {
              scaleNumberInput.addEventListener('click', (e) => e.stopPropagation());
              scaleNumberInput.addEventListener('input', (e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 30 && val <= 300) {
                  setScale(val / 100, 'input');
                }
              });
              scaleNumberInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  scaleNumberInput.blur();
                }
              });
            }

            sizeSlider.addEventListener('input', (e) => {
              const val = parseInt(e.target.value, 10);
              setScale(val / 100, 'slider');
            });

            // 阻止滑块内部点击关闭菜单
            document.getElementById('menu-slider-card').addEventListener('click', (e) => {
              e.stopPropagation();
            });

            // 2. 快捷预设档位点击
            document.querySelectorAll('.catgirl-preset-btn').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetScale = parseFloat(btn.getAttribute('data-scale'));
                setScale(targetScale, 'preset');
              });
            });

            // 3. 鼠标滚轮自由无级微调
            dock.addEventListener('wheel', (e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.06 : -0.06;
              setScale(currentScale + delta, 'wheel');
            }, { passive: false });

            // 4. 待机自动随机彩蛋与点击互动体系
            let interactionStep = 0;
            const animClasses = ['pet-anim-jump', 'pet-anim-squash', 'pet-anim-wiggle', 'pet-anim-duang'];
            let clickStreak = 0;
            let clickStreakTimer = null;
            let lastEggAct = '';

            // 5 个核心保留姿态之外的 5 个动作全量并入待机彩蛋（挥手、崇拜、开心、害羞、困惑）
            const IDLE_EASTER_EGGS = [
              { act: 'wave', quotes: dialogueBank.wave },
              { act: 'starry', quotes: dialogueBank.starry },
              { act: 'cheerful', quotes: dialogueBank.cheerful },
              { act: 'shy', quotes: dialogueBank.shy },
              { act: 'confused', quotes: dialogueBank.confused }
            ];

            function scheduleNextIdleEgg() {
              if (idleEggTimer) clearTimeout(idleEggTimer);
              // 15 ~ 30 秒随机间隔切换待机彩蛋
              const nextDelay = 15000 + Math.floor(Math.random() * 15000);
              idleEggTimer = setTimeout(triggerIdleEasterEgg, nextDelay);
            }

            function triggerIdleEasterEgg() {
              const isIdle = (currentAction === 'idle');
              const noTask = (currentRunningTasks.length === 0);
              const noLock = (Date.now() >= previewLockUntil && Date.now() >= celebrateHoldUntil);
              const notInteracting = (!isPointerDown && !isActualDragging);

              if (!isIdle || !noTask || !noLock || !notInteracting || isEasterEggActive) {
                scheduleNextIdleEgg();
                return;
              }

              // 随机挑一个与上次不同的彩蛋动作
              const candidates = IDLE_EASTER_EGGS.filter(e => e.act !== lastEggAct);
              const picked = (candidates.length > 0 ? candidates : IDLE_EASTER_EGGS)[Math.floor(Math.random() * (candidates.length || IDLE_EASTER_EGGS.length))];
              lastEggAct = picked.act;

              isEasterEggActive = true;
              window.__antigravityCatgirl.setState(picked.act, getNextQuote(picked.quotes), null, {
                force: true,
                showBubble: true
              });

              if (eggTimer) clearTimeout(eggTimer);
              eggTimer = setTimeout(() => {
                if (isEasterEggActive && currentRunningTasks.length === 0 && Date.now() >= previewLockUntil) {
                  isEasterEggActive = false;
                  window.__antigravityCatgirl.setState('idle', null, null, { force: true, showBubble: false, isAuto: true });
                }
                scheduleNextIdleEgg();
              }, 5200);
            }

            function triggerNextInteraction() {
              clickStreak++;
              if (clickStreakTimer) clearTimeout(clickStreakTimer);
              clickStreakTimer = setTimeout(() => { clickStreak = 0; }, 1400);

              stageEl.classList.remove('pet-anim-jump', 'pet-anim-squash', 'pet-anim-wiggle', 'pet-anim-duang', 'pet-idle-blink');
              void stageEl.offsetWidth; // 触发重绘

              const isNoTaskRunning = currentRunningTasks.length === 0;
              const isEgg = isNoTaskRunning && ((clickStreak >= 2) || (Math.random() < 0.45));
              if (isEgg) {
                clickStreak = 0;
                isEasterEggActive = true;
                const candidates = IDLE_EASTER_EGGS.filter(e => e.act !== lastEggAct);
                const picked = (candidates.length > 0 ? candidates : IDLE_EASTER_EGGS)[Math.floor(Math.random() * (candidates.length || IDLE_EASTER_EGGS.length))];
                lastEggAct = picked.act;

                window.__antigravityCatgirl.setState(picked.act, getNextQuote(picked.quotes), null, {
                  force: true,
                  showBubble: true
                });
                if (eggTimer) clearTimeout(eggTimer);
                eggTimer = setTimeout(() => {
                  if (isEasterEggActive && currentRunningTasks.length === 0 && Date.now() >= previewLockUntil) {
                    isEasterEggActive = false;
                    window.__antigravityCatgirl.setState('idle', null, null, { force: true, showBubble: false, isAuto: true });
                  }
                  scheduleNextIdleEgg();
                }, 5200);
                return;
              }

              // 常规待机点击互动
              const currentAnim = animClasses[interactionStep % animClasses.length];
              stageEl.classList.add(currentAnim);
              interactionStep = (interactionStep + 1) % animClasses.length;

              const quote = getNextQuote(dialogueBank.idle);
              showBubble(quote);
              scheduleNextIdleEgg();
            }

            stageEl.addEventListener('animationend', () => {
              stageEl.classList.remove('pet-anim-jump', 'pet-anim-squash', 'pet-anim-wiggle', 'pet-anim-duang');
            });

            // 5. 严格物理对齐防抖拖拽（消除 transform: scale 引起的视觉跳变，1:1 精确跟踪鼠标）
            let isPointerDown = false;
            let isActualDragging = false;
            let startClientX = 0, startClientY = 0;
            let startVisualLeft = 0, startVisualTop = 0;
            let transformOffsetX = 0, transformOffsetY = 0;
            let visualWidth = 120, visualHeight = 168;
            let activePointerId = null;

            bodyEl.addEventListener('pointerdown', (e) => {
              if (e.button !== 0) return;
              isPointerDown = true;
              isActualDragging = false;
              startClientX = e.clientX;
              startClientY = e.clientY;
              activePointerId = e.pointerId;

              const rect = dock.getBoundingClientRect();
              startVisualLeft = rect.left;
              startVisualTop = rect.top;
              visualWidth = rect.width;
              visualHeight = rect.height;

              // 计算 scale 缩放引起的 visual(rect.left/top) 与 layout(dock.offsetLeft/offsetTop) 之间的相对偏差
              transformOffsetX = rect.left - dock.offsetLeft;
              transformOffsetY = rect.top - dock.offsetTop;

              try {
                bodyEl.setPointerCapture(e.pointerId);
              } catch (err) {}
              menu.style.display = 'none';
            });

            window.addEventListener('pointermove', (e) => {
              if (!isPointerDown) return;
              const dx = e.clientX - startClientX;
              const dy = e.clientY - startClientY;

              if (!isActualDragging && Math.hypot(dx, dy) > 5) {
                isActualDragging = true;
                // 一旦进入拖拽，解绑右下角固定定位，转为绝对坐标控制
                dock.style.right = 'auto';
                dock.style.bottom = 'auto';
              }

              if (isActualDragging) {
                // 1:1 精确跟踪鼠标位移，绝不受缩放比例与 transform-origin 影响
                const targetVisualLeft = startVisualLeft + dx;
                const targetVisualTop = startVisualTop + dy;

                // 视口边界碰撞夹紧（基于真实放缩后的 visual 尺寸，绝不出界）
                const minVisualLeft = 10;
                const maxVisualLeft = Math.max(10, window.innerWidth - visualWidth - 10);
                const minVisualTop = 10;
                const maxVisualTop = Math.max(10, window.innerHeight - visualHeight - 10);

                const clampedVisualLeft = Math.max(minVisualLeft, Math.min(maxVisualLeft, targetVisualLeft));
                const clampedVisualTop = Math.max(minVisualTop, Math.min(maxVisualTop, targetVisualTop));

                // 准确还原给 layout style.left / top，消除 scale 偏移影响
                dock.style.left = (clampedVisualLeft - transformOffsetX) + 'px';
                dock.style.top = (clampedVisualTop - transformOffsetY) + 'px';

                updateBubblePosition();
              }
            }, { signal });
            window.addEventListener('resize', updateBubblePosition, { signal });

            function onPointerRelease(e) {
              if (!isPointerDown) return;
              isPointerDown = false;

              if (activePointerId !== null) {
                try {
                  bodyEl.releasePointerCapture(activePointerId);
                } catch (err) {}
                activePointerId = null;
              }

              if (!isActualDragging) {
                triggerNextInteraction();
              }
              isActualDragging = false;
            }

            window.addEventListener('pointerup', onPointerRelease, { signal });
            window.addEventListener('pointercancel', onPointerRelease, { signal });

            // 6. 右键菜单呼出（实时刷新正在运行的任务列表）
            bodyEl.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              e.stopPropagation();

              // 立即使用当前最新的任务数据渲染，并启动后台静默更新
              renderRunningTasksMenu(currentRunningTasks);
              syncDashboardData(true);

              menu.style.display = 'block';
              const menuWidth = 262;
              const menuHeight = menu.offsetHeight || 400;
              let posX = e.clientX;
              let posY = e.clientY;

              if (posX + menuWidth > window.innerWidth) posX = window.innerWidth - menuWidth - 10;
              if (posY + menuHeight > window.innerHeight) {
                posY = Math.max(10, posY - menuHeight);
              }

              menu.style.left = posX + 'px';
              menu.style.top = posY + 'px';

              // 呼出时同步数值输入与滑块数值
              const percent = Math.round(currentScale * 100);
              const slider = document.getElementById('size-slider');
              if (slider) slider.value = percent;
              const numInput = document.getElementById('scale-number-input');
              if (numInput) numInput.value = percent;
              const badge = document.getElementById('slider-val-badge');
              if (badge) badge.textContent = \`\${percent}%\`;
            });

            window.addEventListener('click', () => {
              menu.style.display = 'none';
            }, { signal });

            // 置顶与归位
            let isAlwaysOnTop = true;
            document.getElementById('menu-ontop').addEventListener('click', (e) => {
              e.stopPropagation();
              isAlwaysOnTop = !isAlwaysOnTop;
              document.getElementById('ontop-text').textContent = \`置顶开关: \${isAlwaysOnTop ? '开' : '关'}\`;
              dock.style.zIndex = isAlwaysOnTop ? '99999999' : '1000';
              showBubble(isAlwaysOnTop ? "📌 已开启置顶" : "已切换为常规层级", 1600);
              menu.style.display = 'none';
            });

            document.getElementById('menu-reset').addEventListener('click', (e) => {
              e.stopPropagation();
              resetToCorner();
              showBubble("已安全归位右下角喵~ 🎯", 1800);
              menu.style.display = 'none';
            });

            document.getElementById('menu-close').addEventListener('click', (e) => {
              e.stopPropagation();
              menu.style.display = 'none';
              showBubble("下次开新会话见啦喵~ 👋", 1200);
              setTimeout(() => {
                dock.remove();
                menu.remove();
              }, 600);
            });

            function resetToCorner() {
              dock.style.left = 'auto';
              dock.style.top = 'auto';
              dock.style.right = '32px';
              dock.style.bottom = '24px';
              setScale(1.0, 'preset');
            }

            // Agent 状态分发（防抖动，避免重复切换与重复弹窗）
            window.__antigravityCatgirl = {
              setState: function(state, detail, tokens, opts) {
                const options = (typeof opts === 'boolean') ? { force: opts, showBubble: opts } : (opts || {});
                const isStateChanged = (state !== currentAction);
                const previousAction = currentAction;

                if (!isStateChanged && !options.force) {
                  return;
                }

                if (!options.isAuto) {
                  if (state === 'idle') {
                    previewLockUntil = 0;
                  } else {
                    previewLockUntil = Math.max(previewLockUntil, Date.now() + (options.lockMs || 5200));
                  }
                }

                currentAction = state;
                updateActionMenuUI(state);
                setCodingFxActive(state === 'coding');

                // 清理所有容器附加动效类（由真实 60fps 角色视频呈现全部细腻动作）
                stageEl.classList.remove(
                  'pet-anim-jump', 'pet-anim-squash', 'pet-anim-wiggle', 'pet-anim-duang',
                  'pet-idle-blink', 'pet-anim-warning', 'pet-anim-thinking', 'pet-anim-wave',
                  'pet-anim-starry', 'pet-anim-cheerful', 'pet-anim-shy', 'pet-anim-confused'
                );

                // 预警流汗粒子显隐控制
                const sweatEl = document.getElementById('catgirl-sweat-drop');
                if (state === 'warning') {
                  if (sweatEl) sweatEl.style.display = 'block';
                } else {
                  if (sweatEl) sweatEl.style.display = 'none';
                }

                // 仅在首次挂载且任何视频层尚未就绪前展示静态占位图；一旦视频激活，静态图永久隐藏，彻底根除双层模型重影！
                if (!activeVideo && imgEl) {
                  const targetImg = CATGIRL_IMAGE_MAP[state] || IMAGES.idle;
                  if (targetImg && imgEl.src !== targetImg) {
                    imgEl.src = targetImg;
                  }
                  imgEl.style.display = 'block';
                  imgEl.style.opacity = '1';
                }

                // 启动双缓冲 60fps 角色动作视频无缝切换（内存 Blob 极速解码、0 重影、0 黑屏）
                playActionVideoSeamless(state);

                if (tokens) {
                  tokenTextEl.textContent = 'Token: ' + (tokens > 1000 ? (tokens/1000 | 0) + 'k' : tokens);
                }

                const shouldPopBubble = options.showBubble !== undefined ? options.showBubble : isStateChanged;

                switch(state) {
                  case 'thinking':
                    badgeEl.textContent = '💭';
                    badgeEl.style.background = '#8b5cf6';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.thinking), 3200);
                    break;
                  case 'coding':
                    badgeEl.textContent = '⚡';
                    badgeEl.style.background = '#06b6d4';
                    if (shouldPopBubble) showBubble(detail || "⚡ 正在全速敲键盘处理任务喵~ ⌨️", 2800);
                    break;
                  case 'celebrate':
                    badgeEl.textContent = '🎉';
                    badgeEl.style.background = '#10b981';
                    if (shouldPopBubble) showBubble(detail || "🎉 任务搞定啦，快来验收！✨", 4000);
                    break;
                  case 'warning':
                    badgeEl.textContent = '⚠️';
                    badgeEl.style.background = '#ef4444';
                    setCodingFxActive(false); // 强制关闭敲键盘与飞溅代码
                    let warnDetail = detail;
                    const curPct = (typeof window.__catgirl_current_ctx_pct === 'number' && window.__catgirl_current_ctx_pct > 0) ? window.__catgirl_current_ctx_pct : 80;
                    if (!warnDetail) {
                      warnDetail = "💦 上下文已达 " + curPct + "%！快用 /compact 压缩~";
                    } else if (/上下文已[超达][\\s\\S]*?[0-9]+%/.test(warnDetail)) {
                      // 强制校准气泡文案中的数字与当前胶囊上的真实上下文百分比 100% 保持一致
                      warnDetail = warnDetail.replace(/上下文已[超达][\\s\\S]*?[0-9]+%/, "上下文已达 " + curPct + "%");
                    }
                    if (shouldPopBubble) showBubble(warnDetail, 4200);
                    break;
                  case 'wave':
                    badgeEl.textContent = '👋';
                    badgeEl.style.background = '#ec4899';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.wave), 2800);
                    break;
                  case 'starry':
                    badgeEl.textContent = '⭐';
                    badgeEl.style.background = '#f59e0b';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.starry), 3000);
                    break;
                  case 'cheerful':
                    badgeEl.textContent = '✨';
                    badgeEl.style.background = '#10b981';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.cheerful), 2800);
                    break;
                  case 'shy':
                    badgeEl.textContent = '😳';
                    badgeEl.style.background = '#f43f5e';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.shy), 3000);
                    break;
                  case 'confused':
                    badgeEl.textContent = '❓';
                    badgeEl.style.background = '#a855f7';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.confused), 3000);
                    break;
                  case 'fail':
                    badgeEl.textContent = '💔';
                    badgeEl.style.background = '#ef4444';
                    if (shouldPopBubble) showBubble(detail || "呜……任务遇到报错了，本喵有点沮丧 😿", 3500);
                    break;
                  default: // idle
                    badgeEl.textContent = '🌸';
                    badgeEl.style.background = '#3b82f6';
                    if (shouldPopBubble && detail) {
                      showBubble(detail, 2400);
                    } else if (bubbleWrap && (previousAction === 'warning' || !options.showBubble)) {
                      // 从警报状态恢复到待机时，立即收起预警气泡
                      bubbleWrap.classList.remove('show');
                    }
                    break;
                }
              },
              showBubble: showBubble,
              get action() { return currentAction; }
            };

            // 监听本地 Sidecar SSE 事件（仅响应任务完成庆祝与即时状态同步）
            try {
              if (window.__catgirl_sse) {
                try { window.__catgirl_sse.close(); } catch(e) {}
                window.__catgirl_sse = null;
              }
              const scPort = window.__catgirl_sidecar_port || 18980;
              const evtSource = new EventSource('http://127.0.0.1:' + scPort + '/events');
              window.__catgirl_sse = evtSource;
              evtSource.onmessage = (e) => {
                try {
                  const data = JSON.parse(e.data);
                  if (data.state === 'celebrate') {
                    celebrateHoldUntil = Date.now() + 4500;
                    lastAutoState = 'celebrate';
                    if (!isEasterEggActive && Date.now() > previewLockUntil) {
                      window.__antigravityCatgirl.setState('celebrate', data.detail, data.tokens, {
                        force: true,
                        showBubble: true
                      });
                    }
                  }
                  syncDashboardData();
                } catch(err) {}
              };
              evtSource.onerror = () => {
                try { evtSource.close(); window.__catgirl_sse = null; } catch(e) {}
              };
            } catch(e) {}

            
            // 实时模型与官方配额管理系统（根据输入框当前实时模型自动对齐配额池，完全脱离外部 Dashboard 组绑定）
            let hostQuotaCache = { data: null, lastGroup: '', lastFetched: 0 };

            // 1. 深度动态感知 Antigravity 输入框/对话当前实时生效的具体模型
            function detectActiveComposerModel() {
              try {
                // 优先从 Antigravity 宿主底部输入框旁的模型选择按钮（带有 aria-label="Select model, current: ..."）提取
                const composerBtn = Array.from(document.querySelectorAll('button')).find(b => {
                  const aria = b.getAttribute('aria-label') || '';
                  return aria.toLowerCase().indexOf('select model') !== -1;
                });
                if (composerBtn) {
                  const aria = composerBtn.getAttribute('aria-label') || '';
                  const cIdx = aria.toLowerCase().indexOf('current:');
                  if (cIdx !== -1) {
                    const rawVal = aria.substring(cIdx + 8).trim();
                    if (rawVal) return rawVal;
                  }
                  const txt = (composerBtn.textContent || '').trim();
                  if (txt) return txt;
                }

                // 备用：深度广谱搜索位于界面下半部（输入框附近）包含 Flash / Argon / Gemini 的按钮
                const allBtns = Array.from(document.querySelectorAll('button')).filter(el => {
                  const r = el.getBoundingClientRect();
                  return el.isConnected && r.width > 0 && r.height > 0 && r.top > (window.innerHeight * 0.4);
                });
                for (const btn of allBtns) {
                  const txt = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
                  if (txt.indexOf('Flash') !== -1 || txt.indexOf('Argon') !== -1 || txt.indexOf('Claude') !== -1 || txt.indexOf('GPT') !== -1) {
                    return txt;
                  }
                }

                // 备用：从 Dashboard Shadow DOM 的采样模型提取
                const bar = document.getElementById('ag-pulse-status-bar');
                const shadow = bar?.shadowRoot;
                const ctxModel = shadow?.getElementById('context-model')?.textContent?.trim();
                if (ctxModel && ctxModel !== '—' && ctxModel !== '--') {
                  return ctxModel;
                }
              } catch (e) {}

              return null;
            }

            // 2. 根据当前实时模型，精确映射至对应的官方额度池（Gemini Models / Argon / Claude & GPT）
            function resolveQuotaGroupFromModel(modelName) {
              const m = (modelName || '').toLowerCase();
              if (m.indexOf('argon') !== -1) {
                return {
                  groupId: 'gemini-argon-wtu',
                  groupDisplayName: 'Gemini 4 Argon',
                  badgeName: 'Gemini 4 Argon',
                  isArgon: true,
                  tag: 'Gemini 4 Argon'
                };
              }
              if (m.indexOf('claude') !== -1 || m.indexOf('gpt') !== -1 || m.indexOf('3p') !== -1) {
                let tag = 'Claude / GPT';
                if (m.indexOf('claude 3.7') !== -1) tag = 'Claude 3.7';
                else if (m.indexOf('claude 3.5') !== -1) tag = 'Claude 3.5';
                else if (m.indexOf('gpt-4') !== -1) tag = 'GPT-4o';
                return {
                  groupId: '3p',
                  groupDisplayName: 'Claude and GPT models',
                  badgeName: 'Claude / GPT',
                  isArgon: false,
                  tag: tag
                };
              }
              // 默认为 Gemini 3.8 Flash
              let tag = 'Gemini 3.8 Flash High';
              if (m.indexOf('medium') !== -1) tag = 'Gemini 3.8 Flash Medium';
              else if (m.indexOf('low') !== -1) tag = 'Gemini 3.8 Flash Low';
              else if (m.indexOf('high') !== -1) tag = 'Gemini 3.8 Flash High';
              return {
                groupId: 'gemini',
                groupDisplayName: 'Gemini Models',
                badgeName: 'Gemini 3.8 Flash',
                isArgon: false,
                tag: tag
              };
            }

            // 3. 直接通过 Host React Fiber 提取指定额度组的真实配额与精确倒计时
            async function fetchHostQuotaFromFiber(targetGroupId, force) {
              const chosenGroup = targetGroupId || 'gemini';
              const now = Date.now();
              if (!force && hostQuotaCache.data && (now - hostQuotaCache.lastFetched < 3000) && hostQuotaCache.lastGroup === chosenGroup) {
                return hostQuotaCache.data;
              }
              try {
                const seen = new Set();
                let service = null;
                const allEls = document.querySelectorAll('body *');
                for (let i = 0; i < allEls.length; i++) {
                  const el = allEls[i];
                  const k = Object.keys(el).find(key => key.startsWith('__reactFiber$'));
                  if (!k) continue;
                  let fiber = el[k];
                  for (; fiber && !seen.has(fiber); fiber = fiber.return) {
                    seen.add(fiber);
                    const s = fiber.memoizedProps?.value?.core?.cloudCodeService;
                    if (typeof s?.retrieveUserQuotaSummary === 'function') {
                      service = s;
                      break;
                    }
                  }
                  if (service) break;
                }

                if (service) {
                  const response = await service.retrieveUserQuotaSummary(undefined, false);
                  const allGroups = response?.response?.groups || [];

                  let matchedGroup = null;
                  if (chosenGroup === '3p' || chosenGroup.indexOf('claude') !== -1) {
                    matchedGroup = allGroups.find(g => (g.displayName || g.id || '').toLowerCase().indexOf('claude') !== -1);
                  } else if (chosenGroup === 'gemini-argon-wtu' || chosenGroup.indexOf('argon') !== -1) {
                    matchedGroup = allGroups.find(g => (g.displayName || g.id || '').toLowerCase().indexOf('argon') !== -1);
                  } else {
                    matchedGroup = allGroups.find(g => {
                      const name = (g.displayName || g.id || '').toLowerCase();
                      return name.indexOf('gemini') !== -1 && name.indexOf('argon') === -1;
                    });
                  }

                  if (!matchedGroup && allGroups.length > 0) {
                    matchedGroup = allGroups[0];
                  }

                  function parseDescCountdown(desc) {
                    if (!desc) return '';
                    const m = desc.match(/refresh in ([^.]+)/i);
                    if (!m) return '';
                    let t = m[1].trim();
                    t = t.replace(/days?/g, '天')
                         .replace(/hours?/g, '小时')
                         .replace(/minutes?/g, '分')
                         .replace(/seconds?/g, '秒');
                    t = t.split(',').map(s => s.trim()).join(' ');
                    return t;
                  }

                  function formatCountdown(resetTime) {
                    if (!resetTime) return '--:--';
                    const sec = parseInt(resetTime.seconds ? resetTime.seconds.toString() : '0', 10);
                    if (!sec) return '--:--';
                    const diff = Math.max(0, sec - Math.floor(Date.now() / 1000));
                    if (diff <= 0) return '即将重置';
                    const d = Math.floor(diff / 86400);
                    const h = Math.floor((diff % 86400) / 3600);
                    const m = Math.floor((diff % 3600) / 60);
                    const s = diff % 60;
                    if (d > 0) {
                      return d + '天 ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
                    }
                    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
                  }

                  let f5 = null;
                  let wk = null;
                  let f5Time = '--:--';
                  let wkTime = '--:--';

                  if (matchedGroup && Array.isArray(matchedGroup.buckets)) {
                    for (const bucket of matchedGroup.buckets) {
                      const bId = bucket.bucketId || '';
                      const rawVal = bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : bucket.remaining?.value;
                      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
                        const pctOne = Math.round(rawVal * 1000) / 10;
                        const pctDisplay = (pctOne % 1 === 0 ? pctOne.toFixed(0) : pctOne.toFixed(1)) + '%';
                        const countStr = parseDescCountdown(bucket.description) || formatCountdown(bucket.resetTime);

                        if (bId.indexOf('5h') !== -1) {
                          f5 = pctDisplay;
                          f5Time = countStr;
                        } else if (bId.indexOf('weekly') !== -1) {
                          wk = pctDisplay;
                          wkTime = countStr;
                        }
                      }
                    }
                  }

                  const resData = {
                    fiveHour: f5,
                    weekly: wk,
                    fiveTime: f5Time,
                    weekTime: wkTime,
                    groupDisplayName: matchedGroup?.displayName || 'Gemini Models'
                  };

                  hostQuotaCache.data = resData;
                  hostQuotaCache.lastGroup = chosenGroup;
                  hostQuotaCache.lastFetched = now;
                  return resData;
                }
              } catch (err) {
                console.error('[星星猫娘] Fiber 配额获取异常:', err);
              }
              return hostQuotaCache.data || null;
            }

            // 4. 实时监听输入框与模型切换（响应式模型变动捕获）
            function setupRealtimeModelObserver() {
              try {
                if (window.__catgirl_model_observer) return;
                let observerTimer = null;
                const obs = new MutationObserver(() => {
                  if (observerTimer) return;
                  observerTimer = setTimeout(() => {
                    observerTimer = null;
                    const curModel = detectActiveComposerModel();
                    if (curModel && curModel !== window.__catgirl_last_active_model) {
                      syncDashboardData(true);
                    }
                  }, 120);
                });
                obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'data-testid'] });
                window.__catgirl_model_observer = obs;
              } catch (e) {}
            }

            // 5. 渲染看板视图
            function renderDashboardView(data) {
              const ctxPct = data.ctxPct || 0;
              const tokenDisplay = data.tokenDisplay || '--';
              const quotaGroup = data.quotaGroupName || 'Gemini Models';
              const activeModel = data.contextModel || 'Gemini';

              const fiveNum = parseFloat(data.fiveBalance);
              let quotaText = '5h: --';
              if (!isNaN(fiveNum)) {
                quotaText = '⚡ 5h ' + Math.round(fiveNum) + '%';
              } else if (data.fiveBalance && data.fiveBalance !== '--') {
                quotaText = '🔋 ' + data.fiveBalance;
              } else if (data.weekBalance && data.weekBalance !== '--') {
                quotaText = '🔋 周 ' + data.weekBalance;
              }

              let shortModel = activeModel ? activeModel.replace(/^Gemini[ ]+/i, '').replace(/[ ]+High$/i, '').trim() : 'Gemini';

              const pillPctEl = document.getElementById('live-pill-ctx-pct');
              if (pillPctEl) {
                pillPctEl.textContent = ctxPct + '%';
                if (ctxPct >= 80) pillPctEl.style.color = '#ef4444';
                else if (ctxPct >= 60) pillPctEl.style.color = '#f59e0b';
                else pillPctEl.style.color = '#0f172a';
              }

              const pillTokEl = document.getElementById('live-pill-ctx-tokens');
              if (pillTokEl) {
                let cleanTok = tokenDisplay;
                if (cleanTok.indexOf('/') !== -1) cleanTok = cleanTok.split('/')[0].trim();
                pillTokEl.textContent = cleanTok;
              }

              const pillBarEl = document.getElementById('live-pill-ctx-bar');
              if (pillBarEl) {
                pillBarEl.style.width = Math.min(100, ctxPct) + '%';
                if (ctxPct >= 80) {
                  pillBarEl.style.background = 'linear-gradient(90deg, #f43f5e, #ef4444)';
                } else if (ctxPct >= 60) {
                  pillBarEl.style.background = 'linear-gradient(90deg, #f59e0b, #eab308)';
                } else {
                  pillBarEl.style.background = 'linear-gradient(90deg, #3b82f6, #6366f1)';
                }
              }

              const pillQuotaBadge = document.getElementById('live-pill-quota-badge');
              if (pillQuotaBadge) {
                pillQuotaBadge.textContent = quotaText;
                if (!isNaN(fiveNum) && fiveNum <= 10) {
                  pillQuotaBadge.style.background = '#fff1f2';
                  pillQuotaBadge.style.color = '#e11d48';
                  pillQuotaBadge.style.borderColor = '#fecdd3';
                } else if (!isNaN(fiveNum) && fiveNum <= 30) {
                  pillQuotaBadge.style.background = '#fffbeb';
                  pillQuotaBadge.style.color = '#d97706';
                  pillQuotaBadge.style.borderColor = '#fde68a';
                } else {
                  pillQuotaBadge.style.background = '#eff6ff';
                  pillQuotaBadge.style.color = '#2563eb';
                  pillQuotaBadge.style.borderColor = '#dbeafe';
                }
              }

              const pillModelBadge = document.getElementById('live-pill-model-badge');
              if (pillModelBadge) {
                pillModelBadge.textContent = shortModel;
                pillModelBadge.title = activeModel;
              }

              if (tokenDotEl) {
                if (ctxPct >= 80 || (!isNaN(fiveNum) && fiveNum <= 10)) {
                  tokenDotEl.style.background = '#ef4444';
                  tokenDotEl.style.boxShadow = '0 0 6px rgba(239, 68, 68, 0.5)';
                } else if (ctxPct >= 60 || (!isNaN(fiveNum) && fiveNum <= 30)) {
                  tokenDotEl.style.background = '#f59e0b';
                  tokenDotEl.style.boxShadow = '0 0 6px rgba(245, 158, 11, 0.5)';
                } else {
                  tokenDotEl.style.background = '#10b981';
                  tokenDotEl.style.boxShadow = '0 0 6px rgba(16, 185, 129, 0.45)';
                }
              }

              if (tokenTextEl) {
                tokenTextEl.textContent = 'Ctx: ' + tokenDisplay + ' (' + ctxPct + '%)';
              }

              const pillEl = document.getElementById('live-catgirl-token-pill');
              if (pillEl) {
                pillEl.title = "当前实时模型: " + activeModel + " | 上下文: " + (data.contextTokens || (tokenDisplay + " tok")) + " (" + ctxPct + "% 已用) | [" + quotaGroup + "] 5小时: " + data.fiveBalance + " · 周: " + data.weekBalance + " (点击展开完整看板)";
              }

              const hudFiveVal = document.getElementById('live-hud-five-val');
              const hudFiveBar = document.getElementById('live-hud-five-bar');
              const hudFiveTime = document.getElementById('live-hud-five-time');
              const hudWeekVal = document.getElementById('live-hud-week-val');
              const hudWeekBar = document.getElementById('live-hud-week-bar');
              const hudWeekTime = document.getElementById('live-hud-week-time');
              const hudCtxBadge = document.getElementById('live-hud-ctx-badge');
              const hudCtxBar = document.getElementById('live-hud-ctx-bar');
              const hudCtxTokens = document.getElementById('live-hud-ctx-tokens');
              const hudCtxHint = document.getElementById('live-hud-ctx-hint');
              const hudTodayVal = document.getElementById('live-hud-today-val');
              const hudMonthVal = document.getElementById('live-hud-month-val');
              const hudTpsVal = document.getElementById('live-hud-tps-val');
              const hudCacheVal = document.getElementById('live-hud-cache-val');
              const hudModelTag = document.getElementById('live-hud-model-tag');
              const hudQuotaGroupName = document.getElementById('live-hud-quota-group-name');
              const hudQuotaStatus = document.getElementById('live-hud-quota-status');
              const hudBottomBtn = document.getElementById('live-hud-open-full-dashboard');

              if (hudQuotaGroupName) hudQuotaGroupName.textContent = quotaGroup;

              if (hudFiveVal) hudFiveVal.textContent = data.fiveBalance;
              if (hudFiveBar) {
                if (data.fiveBalance === '随周额度' || data.fiveBalance === '不限') {
                  hudFiveBar.style.width = '100%';
                  hudFiveBar.style.background = 'linear-gradient(90deg, #38bdf8, #818cf8)';
                } else {
                  hudFiveBar.style.width = data.fiveBalance.includes('%') ? data.fiveBalance : '100%';
                  if (!isNaN(fiveNum)) {
                    if (fiveNum <= 10) hudFiveBar.style.background = 'linear-gradient(90deg, #f43f5e, #e11d48)';
                    else if (fiveNum <= 30) hudFiveBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
                    else hudFiveBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
                  }
                }
              }
              if (hudFiveTime) hudFiveTime.textContent = data.fiveCountdown;

              if (hudWeekVal) hudWeekVal.textContent = data.weekBalance;
              if (hudWeekBar) {
                hudWeekBar.style.width = data.weekBalance.includes('%') ? data.weekBalance : '100%';
                const weekNum = parseFloat(data.weekBalance);
                if (!isNaN(weekNum)) {
                  if (weekNum <= 10) hudWeekBar.style.background = 'linear-gradient(90deg, #f43f5e, #e11d48)';
                  else if (weekNum <= 30) hudWeekBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
                  else hudWeekBar.style.background = 'linear-gradient(90deg, #38bdf8, #2563eb)';
                }
              }
              if (hudWeekTime) hudWeekTime.textContent = data.weekCountdown;

              if (hudCtxBadge) hudCtxBadge.textContent = ctxPct + '% 已用';
              if (hudCtxBar) hudCtxBar.style.width = ctxPct + '%';
              if (hudCtxTokens) hudCtxTokens.textContent = data.contextTokens || (tokenDisplay + ' / 256K tok');

              if (hudCtxHint) {
                if (ctxPct >= 80) {
                  hudCtxHint.textContent = '⚠️ 超过 80%！快用 /compact 压缩';
                  hudCtxHint.style.color = '#ef4444';
                } else if (ctxPct >= 60) {
                  hudCtxHint.textContent = '⚡ 建议适时 /compact 压缩';
                  hudCtxHint.style.color = '#f59e0b';
                } else {
                  hudCtxHint.textContent = '✨ 上下文充裕，状态极佳';
                  hudCtxHint.style.color = '#34d399';
                }
              }

              if (hudQuotaStatus) {
                if (!isNaN(fiveNum) && fiveNum <= 15) {
                  hudQuotaStatus.textContent = '⚠️ 额度告急';
                  hudQuotaStatus.style.color = '#f43f5e';
                } else if (!isNaN(fiveNum) && fiveNum <= 30) {
                  hudQuotaStatus.textContent = '⚡ 额度偏低';
                  hudQuotaStatus.style.color = '#f59e0b';
                } else {
                  hudQuotaStatus.textContent = '充裕健康';
                  hudQuotaStatus.style.color = '#38bdf8';
                }
              }

              if (hudTodayVal) hudTodayVal.textContent = data.today;
              if (hudMonthVal) hudMonthVal.textContent = data.month;
              if (hudTpsVal) hudTpsVal.textContent = data.tps;
              if (hudCacheVal) hudCacheVal.textContent = data.cacheRate;
              if (hudModelTag) hudModelTag.textContent = data.contextModel;

              if (hudBottomBtn) {
                if (data.mode === 'native') {
                  hudBottomBtn.textContent = '✨ 运行中：星星猫娘原生统计 + 官方 Fiber 额度';
                  hudBottomBtn.title = '未安装外部 Dashboard 插件，已通过 React Fiber 原生直连 Google 官方 5h/1周额度，并实时统计本地 Token';
                } else {
                  hudBottomBtn.textContent = '🔗 打开完整 Dashboard 统计';
                  hudBottomBtn.title = '已联动 Antigravity Dashboard 插件，点击呼出完整分析面板';
                }
              }
            }

            // 6. 姿态自动同步
            function applyAutoPoseFromStats(stats, effectiveCtxPct) {
              ensureActiveVideoPlaying();
              if (!stats) return;
              renderRunningTasksMenu(stats.runningTasks || []);

              if (Date.now() < previewLockUntil) {
                return;
              }

              const runningCount = Array.isArray(stats.runningTasks) ? stats.runningTasks.length : 0;
              let isWarning = false;
              if (effectiveCtxPct >= 80) {
                isWarning = true;
              } else if (currentAction === 'warning' && effectiveCtxPct >= 75) {
                // 迟滞回差保护：触发预警后只要上下文未降至 75% 以下，就持续保持预警姿态，避免在 80% 临界点反复震荡横跳！
                isWarning = true;
              }

              const hasUrgentTaskOrAlert = (stats.autoState === 'celebrate' || Date.now() < celebrateHoldUntil || isWarning || runningCount > 0 || stats.hasRunningTask);

              // 如果当前正在播放待机彩蛋，但任务状态发生实质性变化（有任务运行、预警或庆祝），必须立即打断彩蛋并切入任务状态！
              if (isEasterEggActive && hasUrgentTaskOrAlert) {
                isEasterEggActive = false;
                if (eggTimer) {
                  clearTimeout(eggTimer);
                  eggTimer = null;
                }
              }

              if (isEasterEggActive) {
                return;
              }

              let targetState = 'idle';
              let targetDetail = '';

              if (stats.autoState === 'celebrate' || Date.now() < celebrateHoldUntil) {
                targetState = 'celebrate';
                targetDetail = stats.autoDetail || "🎉 任务搞定啦，快来验收！✨";
                if (stats.completedTask && stats.completedTask.id && stats.completedTask.id !== lastCompletedTaskId) {
                  lastCompletedTaskId = stats.completedTask.id;
                  celebrateHoldUntil = Date.now() + 4500;
                  window.__antigravityCatgirl.setState('celebrate', targetDetail, null, {
                    force: true,
                    showBubble: true,
                    isAuto: true
                  });
                  return;
                }
              } else if (isWarning) {
                targetState = 'warning';
                targetDetail = "💦 上下文已达 " + effectiveCtxPct + "%！快用 /compact 压缩~";
              } else if (runningCount > 0 || stats.hasRunningTask) {
                targetState = 'coding';
                targetDetail = stats.autoDetail || "💻 正在飞速写代码，任务全速推进中...";
              } else {
                targetState = 'idle';
                targetDetail = '';
              }

              // 仅在姿态发生实质性变化时才触发 setState，绝不重复触发视频加载与重绘！
              if (currentAction !== targetState) {
                window.__antigravityCatgirl.setState(targetState, targetDetail, null, {
                  force: true,
                  showBubble: (targetState === 'celebrate' || targetState === 'warning'),
                  isAuto: true
                });
              }

              // 当处于空闲待机且未排队彩蛋定时器时，启动待机彩蛋调度
              if (targetState === 'idle' && !idleEggTimer) {
                scheduleNextIdleEgg();
              }
            }

            // 7. 核心数据同步（根据当前对话正在实时使用的模型进行智能配额切换，绝不依赖外部 Dashboard）
            async function syncDashboardData(force = false) {
              try {
                setupRealtimeModelObserver();
                const bar = document.getElementById('ag-pulse-status-bar');
                const shadow = bar?.shadowRoot;
                const sidecarPort = window.__catgirl_sidecar_port || 51149;

                // 1. 动态感知当前对话正在实时生效的具体模型
                const activeModel = detectActiveComposerModel() || 'Gemini 3.8 Flash High';

                // 2. 将当前模型精准映射至官方额度组 (Gemini Models / 4 Argon / Claude & GPT)
                const quotaMeta = resolveQuotaGroupFromModel(activeModel);

                // 3. 监听模型切换事件并给出轻量萌态气泡提示
                if (window.__catgirl_last_active_model && window.__catgirl_last_active_model !== activeModel) {
                  console.log('[星星猫娘] 实时感知到模型切换: ' + window.__catgirl_last_active_model + ' -> ' + activeModel);
                  if (window.__antigravityCatgirl?.showBubble && !isEasterEggActive) {
                    window.__antigravityCatgirl.showBubble('⚡ 实时切换至模型：' + activeModel + '，额度池已自动同步喵~ 🐾', 2500);
                  }
                  force = true;
                }
                window.__catgirl_last_active_model = activeModel;

                // 4. 从 React Fiber 原生直连获取该模型对应的最权威 5h & 周配额与重置时间
                let realFive = '--';
                let realWeek = '--';
                let fiveCount = '--:--';
                let weekCount = '--:--';

                try {
                  const fiberQuota = await fetchHostQuotaFromFiber(quotaMeta.groupId, force);
                  if (fiberQuota) {
                    if (quotaMeta.isArgon) {
                      realFive = '随周额度';
                      fiveCount = '无单独限制';
                    } else if (fiberQuota.fiveHour) {
                      realFive = typeof fiberQuota.fiveHour === 'number' ? (fiberQuota.fiveHour + '%') : fiberQuota.fiveHour;
                      fiveCount = fiberQuota.fiveTime || '--:--';
                    }
                    if (fiberQuota.weekly) {
                      realWeek = typeof fiberQuota.weekly === 'number' ? (fiberQuota.weekly + '%') : fiberQuota.weekly;
                      weekCount = fiberQuota.weekTime || '--:--';
                    }
                  }
                } catch (e) {
                  console.warn('[星星猫娘] 获取 Fiber 配额出错:', e);
                }

                // 5. 尝试读取本地 sidecar 统计（设置 2500ms 超时）
                let stats = null;
                try {
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 2500);
                  const currentPctParam = (typeof window.__catgirl_current_ctx_pct === 'number' && window.__catgirl_current_ctx_pct > 0) ? ('?host_ctx_pct=' + window.__catgirl_current_ctx_pct) : '';
                  const resp = await fetch('http://127.0.0.1:' + sidecarPort + '/api/stats' + currentPctParam, {
                    signal: controller.signal,
                    cache: 'no-store'
                  });
                  clearTimeout(timer);
                  if (resp.ok) stats = await resp.json();
                } catch (e) {}

                // 6. 读取上下文与历史汇总指标（完全脱离 Dashboard 的额度组切换）
                let today = stats?.today || '0';
                let month = stats?.month || '0';
                let tps = stats?.tps ? stats.tps + ' tok/s' : '118.4 tok/s';
                let cacheRate = stats?.cacheRate || '--';
                let ctxTokens = stats?.contextTokens ? stats.contextTokens + ' tok' : '--';
                let ctxPct = stats?.contextPercent || 0;

                if (shadow) {
                  const getText = (id) => shadow.getElementById(id)?.textContent?.trim() || '';
                  if (getText('usage-today')) today = getText('usage-today');
                  if (getText('usage-month')) month = getText('usage-month');
                  if (getText('session-rate') || getText('tps')) tps = getText('session-rate') || (getText('tps') + ' tok/s');
                  if (getText('cache-rate')) cacheRate = getText('cache-rate');

                  const shadowTokens = getText('context-tokens');
                  if (shadowTokens && shadowTokens !== '--') ctxTokens = shadowTokens;

                  const shadowPercent = getText('context-percent');
                  if (shadowPercent && shadowPercent !== '—') {
                    const p = parseInt(shadowPercent, 10);
                    if (!isNaN(p)) ctxPct = p;
                  } else {
                    const match = (getText('context-summary') || '').match(/([0-9]+)%/);
                    if (match) ctxPct = parseInt(match[1], 10);
                  }
                }

                window.__catgirl_current_ctx_pct = ctxPct;

                renderDashboardView({
                  mode: shadow ? 'pulse' : 'native',
                  quotaGroupName: quotaMeta.badgeName,
                  tokenDisplay: ctxTokens,
                  ctxPct,
                  contextModel: quotaMeta.tag || activeModel,
                  fiveBalance: realFive,
                  fiveCountdown: fiveCount,
                  weekBalance: realWeek,
                  weekCountdown: weekCount,
                  today,
                  month,
                  tps,
                  cacheRate,
                  contextTokens: ctxTokens
                });

                if (stats) applyAutoPoseFromStats(stats, ctxPct);
              } catch (e) {
                console.error('[星星猫娘] 同步异常:', e);
              }
            }
            window.__catgirl_sync_dashboard = syncDashboardData;

            // 8. 切换看板展示
            function toggleDashboardHud(force) {
              const hud = document.getElementById('catgirl-dashboard-hud');
              if (!hud) return;
              isHudOpen = force !== undefined ? force : !isHudOpen;
              if (isHudOpen) {
                syncDashboardData();
                hud.classList.remove('hud-hidden');
                hud.classList.add('hud-visible');
                menu.style.display = 'none';
              } else {
                hud.classList.remove('hud-visible');
                hud.classList.add('hud-hidden');
              }
            }

            // 点击胶囊展开/收起 HUD
            const pillEl = document.getElementById('live-catgirl-token-pill');
            if (pillEl) {
              pillEl.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDashboardHud();
              });
            }

            // 双击角色展开 HUD
            bodyEl.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              toggleDashboardHud(true);
            });

            // 关闭按钮
            const hudCloseBtn = document.getElementById('live-hud-close-btn');
            if (hudCloseBtn) {
              hudCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDashboardHud(false);
              });
            }

            // 额度模型组点击按钮：即时刷新当前活跃模型配额
            const hudQuotaGroupBtn = document.getElementById('live-hud-quota-group-btn');
            if (hudQuotaGroupBtn) {
              hudQuotaGroupBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const activeModel = detectActiveComposerModel() || 'Gemini 3.8 Flash High';
                syncDashboardData(true);
                if (window.__antigravityCatgirl?.showBubble) {
                  window.__antigravityCatgirl.showBubble('⚡ 已实时刷新当前模型：' + activeModel + ' 配额喵~ 🔋', 2200);
                }
              });
            }

            // 右键菜单项点击
            const menuDashBtn = document.getElementById('menu-dashboard');
            if (menuDashBtn) {
              menuDashBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDashboardHud(true);
              });
            }

            // 打开完整 Dashboard 面板联动
            const hudOpenFull = document.getElementById('live-hud-open-full-dashboard');
            if (hudOpenFull) {
              hudOpenFull.addEventListener('click', (e) => {
                e.stopPropagation();
                const bar = document.getElementById('ag-pulse-status-bar');
                const btn = bar?.shadowRoot?.getElementById('open-usage');
                if (btn) {
                  btn.click();
                  showBubble("已呼出完整 Dashboard 用量分析面板喵~ 📊", 2500);
                } else {
                  showBubble("已展示最新 Token 统计数据喵~ ✨", 2000);
                }
              });
            }

            // 点击外部关闭 HUD
            document.addEventListener('pointerdown', (e) => {
              if (isHudOpen && !dock.contains(e.target)) {
                toggleDashboardHud(false);
              }
            }, { signal });

            // 启动定时轮询同步、全动作 60fps 视频内存预加载与实时模型观察器
            setupRealtimeModelObserver();
            preloadAllActionVideos();
            window.__antigravityCatgirl.setState('idle', null, null, { force: true, showBubble: false, isAuto: true });
            syncDashboardData();
            window.__catgirl_sync_timer = setInterval(syncDashboardData, 1800);
            scheduleNextIdleEgg();

            showBubble("AI Buddy 已就绪！随时陪你全速敲代码~ ✨", 2600);
              return 'PET_INJECTED_OK';
            }
            return mountPet();
          })();
        `;

        try {
          ws.send(JSON.stringify({ id: 104, method: 'Page.enable' }));
        } catch (e) {}

        ws.send(JSON.stringify({
          id: 105,
          method: 'Runtime.evaluate',
          params: { expression: clientScript }
        }));

        try {
          ws.send(JSON.stringify({
            id: 106,
            method: 'Page.addScriptToEvaluateOnNewDocument',
            params: { source: clientScript }
          }));
        } catch (e) {}
      }
    });
  });
}

main().catch(console.error);
