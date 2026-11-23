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
  throw new Error(
    '未找到 DevToolsActivePort 文件：新版 Antigravity 默认未开启 CDP 调试端口（或刚自动更新重启）。\n' +
    '请运行插件根目录的 fix_cdp.bat（或为 Antigravity 快捷方式添加启动参数 --remote-debugging-port=0），然后完全退出并从快捷方式重新启动 Antigravity。'
  );
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

function getConfigPaths() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const paths = [];
  if (home) {
    paths.push(path.join(home, '.gemini', 'antigravity', 'catgirl_pet_config.json'));
    paths.push(path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet', 'pet_config.json'));
  }
  paths.push(path.join(__dirname, '..', 'pet_config.json'));
  return paths;
}

function loadPetConfig() {
  for (const p of getConfigPaths()) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') return data;
      }
    } catch (e) {}
  }
  return { scale: 1.3 };
}

function savePetConfig(cfg) {
  for (const p of getConfigPaths()) {
    try {
      const dir = path.dirname(p);
      if (fs.existsSync(dir)) {
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
      }
    } catch (e) {}
  }
}

async function main() {
  const isEnsure = process.argv.includes('--ensure');
  const petConfig = loadPetConfig();
  const initialScale = (typeof petConfig.scale === 'number' && !isNaN(petConfig.scale))
    ? Math.max(0.4, Math.min(2.5, petConfig.scale))
    : 1.3;

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
      path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet', 'sidecars', 'pet-widget', '.port'),
      path.join(home, '.gemini', 'config', 'plugins', 'antigravity-catgirl-pet', '.port'),
      path.join(__dirname, '..', 'sidecars', 'pet-widget', '.port'),
      path.join(__dirname, '..', '.port')
    ].filter(p => fs.existsSync(p));

    portCandidates.sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch (e) { return 0; }
    });

    for (const p of portCandidates) {
      const val = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (val > 0) { sidecarPort = val; break; }
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
      // 仅筛选真正的 Antigravity 主工作区窗口，排除内置浏览器打开的外部/预览网页与 data: 闪屏
      const isMainAntigravityPage = (t) => {
        if (t.type !== 'page' || !t.webSocketDebuggerUrl || !t.url || t.url.startsWith('data:')) return false;
        const title = t.title || '';
        if (title.includes('Antigravity')) return true;
        return t.url.startsWith('vscode-file://') || t.url.startsWith('file://');
      };
      const pages = list.filter(isMainAntigravityPage);
      if (!isEnsure) {
        const extraPages = list.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !isMainAntigravityPage(t) && t.url && !t.url.startsWith('data:'));
        extraPages.forEach((extra) => {
          try {
            const cws = new WebSocket(extra.webSocketDebuggerUrl);
            cws.onopen = () => {
              cws.send(JSON.stringify({
                id: 901,
                method: 'Runtime.evaluate',
                params: {
                  expression: '(function(){if(!document.getElementById("antigravity-catgirl-dock"))return false;try{window.__catgirl_cleanup&&window.__catgirl_cleanup()}catch(e){}try{clearInterval(window.__catgirl_sync_timer)}catch(e){}try{window.__catgirl_sse&&window.__catgirl_sse.close()}catch(e){}["antigravity-catgirl-dock","antigravity-catgirl-contextmenu","antigravity-catgirl-analytics-modal","antigravity-catgirl-style"].forEach(id=>{const el=document.getElementById(id);if(el)el.remove()});return true})()'
                }
              }));
            };
            cws.onmessage = () => cws.close();
            cws.onerror = () => cws.close();
          } catch (e) {}
        });
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
            window.__catgirl_initial_scale = ${initialScale};
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
            const oldModal = document.getElementById('catgirl-analytics-modal');
            if (oldModal) oldModal.remove();

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
              if (typeof window.__catgirl_stop_sprite_engine === 'function') {
                try { window.__catgirl_stop_sprite_engine(); } catch(e) {}
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
                transition: transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
              }
              #catgirl-anim-stage.pet-pressed {
                transform: scale(0.975);
              }

              #catgirl-ground-shadow {
                position: absolute;
                bottom: 2px;
                left: 50%;
                transform: translateX(-50%);
                width: 64px;
                height: 10px;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0.34);
                filter: blur(4px);
                pointer-events: none;
                z-index: 0;
              }

              #catgirl-img {
                width: 110px;
                height: 100%;
                object-fit: contain;
                display: block;
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
                pointer-events: none;
                opacity: 0;
                display: none;
                transition: none !important;
              }

              #catgirl-canvas {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                opacity: 0;
                display: none;
                z-index: 3;
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

              /* 预警冷汗提示滴 */
              .sweat-drop {
                position: absolute;
                top: 14px;
                right: 20px;
                width: 8px;
                height: 12px;
                background: #38bdf8;
                border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
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

              /* 状态角标（低干扰石墨底线性图标） */
              #catgirl-status-badge {
                position: absolute;
                bottom: 4px;
                right: 4px;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #19191b;
                border: 1.5px solid rgba(237, 237, 237, 0.2);
                color: #a1a1a6;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
                transition: border-color 0.16s cubic-bezier(0.22, 1, 0.36, 1), color 0.16s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.16s cubic-bezier(0.22, 1, 0.36, 1);
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

              /* 哑光机械微键盘 (Tactile Mini Desk Keyboard) */
              #catgirl-holo-keyboard {
                position: absolute;
                bottom: 32px;
                left: 50%;
                width: 84px;
                height: 26px;
                transform: translateX(-50%) perspective(240px) rotateX(26deg);
                transform-origin: center bottom;
                background: rgba(20, 20, 22, 0.94);
                border: 1px solid rgba(237, 237, 237, 0.18);
                border-radius: 5px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
                padding: 3px 4px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                pointer-events: none;
                z-index: 10;
                opacity: 1;
                transition: opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1), transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
              }

              #catgirl-holo-keyboard.holo-hidden {
                opacity: 0;
                transform: translateX(-50%) perspective(240px) rotateX(26deg) scale(0.85) translateY(8px);
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
                transition: transform 0.08s cubic-bezier(0.22, 1, 0.36, 1);
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
                background: #27272a;
                border-radius: 3px 3px 2px 2px;
                border: 1px solid rgba(237, 237, 237, 0.28);
              }
              .hand-palm {
                width: 13px;
                height: 9px;
                background: #f5ebe6;
                border-radius: 4px 4px 6px 6px;
                margin-top: -1px;
                border: 1px solid rgba(231, 204, 196, 0.9);
                position: relative;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
              }
              .hand-palm::after {
                content: '';
                position: absolute;
                bottom: 1.5px;
                left: 50%;
                transform: translateX(-50%);
                width: 6px;
                height: 2.5px;
                background: #d8a7b1;
                border-radius: 2px;
                opacity: 0.75;
              }
              /* 敲击瞬间准确下压 */
              .typing-hand.hand-down {
                transform: translateY(4px) scale(0.94) !important;
              }

              /* 机械微键帽与按压下沉反馈 */
              .holo-key-row {
                display: flex;
                gap: 2px;
                width: 100%;
                justify-content: center;
              }
              .holo-key {
                flex: 1;
                height: 4px;
                background: #2e2e32;
                border-top: 1px solid rgba(237, 237, 237, 0.14);
                border-radius: 1.5px;
                transition: background-color 0.08s ease, transform 0.08s ease, border-color 0.08s ease;
              }
              .holo-key.active-tap {
                background: #38bdf8 !important;
                border-top-color: #bae6fd;
                transform: translateY(1px);
              }
              .holo-key-space {
                flex: 3;
              }

              /* 轻量化打字字符提示（无荧光阴影） */
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
                font-weight: 500;
                font-size: 9px;
                line-height: 1;
                white-space: nowrap;
                user-select: none;
                pointer-events: none;
                animation: particleFloat 0.85s cubic-bezier(0.22, 1, 0.36, 1) forwards;
              }
              @keyframes particleFloat {
                0% {
                  opacity: 0;
                  transform: translate(0, 0);
                }
                25% {
                  opacity: 0.85;
                  transform: translate(var(--p-dx, 0px), -12px);
                }
                100% {
                  opacity: 0;
                  transform: translate(calc(var(--p-dx, 0px) * 1.4), -36px);
                }
              }

              /* 肚皮 Token 水位精致胶囊（浅色石墨中性阶，对齐 4px 栅格） */
              #live-catgirl-token-pill {
                margin-top: -4px;
                padding: 4px 8px;
                border-radius: 8px;
                background: #fafafa !important;
                border: 1px solid rgba(23, 23, 23, 0.12) !important;
                color: #171717 !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                cursor: pointer;
                width: 104px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                gap: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), transform 0.15s cubic-bezier(0.22, 1, 0.36, 1);
                user-select: none;
              }
              #live-catgirl-token-pill:hover {
                background: #ffffff !important;
                border-color: rgba(23, 23, 23, 0.24) !important;
              }
              #live-catgirl-token-pill:active {
                transform: scale(0.98);
              }
              .pill-row-top {
                display: flex;
                align-items: center;
                gap: 4px;
                line-height: 1;
                width: 100%;
              }
              #live-catgirl-token-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #16a34a;
                flex-shrink: 0;
                transition: background-color 0.2s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .pill-label {
                font-size: 9px;
                font-weight: 500;
                color: #525252;
                flex-shrink: 0;
              }
              .pill-val-bold {
                font-size: 10px;
                font-weight: 600;
                color: #171717;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                flex-shrink: 0;
              }
              .pill-val-sub {
                font-size: 9px;
                font-weight: 400;
                color: #737373;
                margin-left: auto;
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
              }
              .pill-track {
                width: 100%;
                height: 2px;
                background: #e5e5e5;
                border-radius: 1px;
                overflow: hidden;
              }
              .pill-bar {
                height: 100%;
                width: 0%;
                border-radius: 1px;
                background: #171717;
                transition: width 0.25s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.25s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .pill-row-bottom {
                display: flex;
                align-items: center;
                gap: 4px;
                line-height: 1;
                width: 100%;
              }
              .pill-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1.2;
              }
              .pill-badge-quota {
                background: #f4f4f5;
                color: #171717;
                border: 1px solid rgba(23, 23, 23, 0.08);
                font-size: 9px;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                padding: 1px 4px;
                border-radius: 4px;
                white-space: nowrap;
                flex-shrink: 0;
              }
              .pill-badge-model {
                background: #f4f4f5;
                color: #525252;
                border: 1px solid rgba(23, 23, 23, 0.08);
                font-size: 9px;
                font-weight: 500;
                padding: 1px 4px;
                border-radius: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 48px;
                margin-left: auto;
              }

              /* 猫娘专属 Token & 额度仪表盘 HUD 卡片（Graphite 中性面板 + 四角视口自适应避让） */
              #catgirl-dashboard-hud {
                position: fixed;
                width: 248px;
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.12);
                border-radius: 14px;
                padding: 12px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
                color: #ededed;
                z-index: 100000001;
                transform-origin: top left;
                max-height: calc(100vh - 20px);
                overflow-y: auto;
                overflow-x: hidden;
                scrollbar-width: thin;
                scrollbar-color: rgba(237, 237, 237, 0.18) transparent;
                user-select: none;
                transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1), transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
              }
              #catgirl-dashboard-hud.hud-hidden {
                opacity: 0;
                pointer-events: none;
                transform: translateY(4px) scale(0.84);
                display: none;
              }
              #catgirl-dashboard-hud.hud-visible {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0) scale(0.86);
                display: block;
              }
              .hud-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(237, 237, 237, 0.08);
                margin-bottom: 12px;
              }
              .hud-title-box {
                display: flex;
                align-items: center;
                gap: 8px;
              }
              .hud-title-icon {
                color: #85858b;
                display: inline-flex;
                align-items: center;
              }
              .hud-title {
                font-size: 13px;
                font-weight: 600;
                color: #ededed;
              }
              .hud-actions {
                display: flex;
                align-items: center;
                gap: 4px;
              }
              .hud-badge {
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 4px;
                background: #232325;
                border: 1px solid rgba(237, 237, 237, 0.1);
                color: #a1a1a6;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                max-width: 120px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .hud-btn-icon {
                background: transparent;
                border: 1px solid transparent;
                color: #85858b;
                width: 24px;
                height: 24px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                border-radius: 6px;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .hud-btn-icon:hover {
                color: #ededed;
                background: #232325;
              }
              .hud-section {
                margin-bottom: 12px;
              }
              .hud-section:last-of-type {
                margin-bottom: 0;
              }
              .hud-section-title {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 11px;
                font-weight: 500;
                color: #a1a1a6;
                margin-bottom: 8px;
              }
              .hud-section-title-left {
                display: flex;
                align-items: center;
                gap: 6px;
                color: #ededed;
                font-weight: 500;
              }
              .hud-group-pill {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.12);
                color: #a1a1a6;
                font-size: 10px;
                font-weight: 500;
                padding: 2px 6px;
                border-radius: 4px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
                user-select: none;
                line-height: 1.3;
              }
              .hud-group-pill:hover {
                background: #232325;
                border-color: rgba(237, 237, 237, 0.22);
                color: #ededed;
              }
              .hud-group-pill:active {
                transform: scale(0.98);
              }
              .hud-gauge-row {
                margin-bottom: 8px;
              }
              .hud-gauge-info {
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                margin-bottom: 4px;
              }
              .hud-gauge-info .hud-label {
                color: #a1a1a6;
              }
              .hud-gauge-info .hud-val {
                color: #ededed;
                font-weight: 600;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
              }
              .hud-track {
                width: 100%;
                height: 4px;
                border-radius: 2px;
                background: rgba(237, 237, 237, 0.1);
                overflow: hidden;
                position: relative;
              }
              .hud-fill {
                height: 100%;
                border-radius: 2px;
                transition: width 0.28s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.2s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .hud-fill-five {
                background: #4cc38a;
              }
              .hud-fill-week {
                background: #38bdf8;
              }
              .hud-fill-ctx {
                background: #38bdf8;
              }
              .hud-timer-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 10px;
                color: #85858b;
                margin-top: 4px;
              }
              .hud-timer {
                color: #a1a1a6;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
              }
              .hud-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 6px;
              }
              .hud-metric-card {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 8px;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 2px;
              }
              .hud-metric-label {
                font-size: 10px;
                color: #85858b;
              }
              .hud-metric-val {
                font-size: 13px;
                font-weight: 600;
                color: #ededed;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
              }
              .hud-footer {
                padding-top: 8px;
                margin-top: 12px;
                border-top: 1px solid rgba(237, 237, 237, 0.08);
                display: none;
                gap: 8px;
              }
              .hud-btn-primary {
                flex: 1;
                background: #232325;
                color: #ededed;
                border: 1px solid rgba(237, 237, 237, 0.14);
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 11px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .hud-btn-primary:hover {
                background: #2c2c2f;
                border-color: rgba(237, 237, 237, 0.24);
              }
              .hud-btn-primary:active {
                transform: scale(0.98);
              }
              .hud-analytics-entry-btn {
                background: #232325;
                border: 1px solid rgba(237, 237, 237, 0.14);
                color: #ededed;
                font-size: 10.5px;
                font-weight: 500;
                padding: 3px 8px;
                border-radius: 6px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .hud-analytics-entry-btn:hover {
                background: #2c2c2f;
                border-color: #38bdf8;
                color: #ffffff;
              }
              .hud-quota-switcher {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-bottom: 8px;
                flex-wrap: wrap;
              }
              .hud-quota-tab {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.08);
                color: #85858b;
                font-size: 10px;
                font-weight: 500;
                padding: 2px 6px;
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .hud-quota-tab:hover {
                background: #232325;
                color: #ededed;
              }
              .hud-quota-tab.active {
                background: #232325;
                border-color: rgba(56, 189, 248, 0.45);
                color: #38bdf8;
              }

              /* 全量用量统计与全模型额度中心弹窗（Graphite 中性阶 + 统一 #38bdf8 强调色） */
              #catgirl-analytics-modal {
                position: fixed;
                inset: 0;
                z-index: 100000010;
                background: rgba(10, 10, 11, 0.76);
                backdrop-filter: blur(6px);
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
                color: #ededed;
                padding: 16px;
                box-sizing: border-box;
              }
              .cg-modal-card {
                width: min(940px, 94vw);
                max-height: min(690px, 90vh);
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.1);
                border-radius: 16px;
                box-shadow: 0 24px 64px rgba(0, 0, 0, 0.72);
                display: flex;
                flex-direction: column;
                overflow: hidden;
              }
              .cg-modal-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px 12px;
                border-bottom: 1px solid rgba(237, 237, 237, 0.08);
              }
              .cg-modal-title {
                font-size: 18px;
                font-weight: 600;
                color: #ededed;
              }
              .cg-modal-sub {
                font-size: 12px;
                color: #85858b;
                margin-top: 4px;
                display: flex;
                align-items: center;
                gap: 6px;
              }
              .cg-dot-green {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #4cc38a;
                display: inline-block;
              }
              .cg-head-actions {
                display: flex;
                align-items: center;
                gap: 8px;
              }
              .cg-icon-btn {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.1);
                color: #a1a1a6;
                border-radius: 8px;
                height: 28px;
                min-width: 28px;
                padding: 0 8px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-icon-btn:hover {
                background: #232325;
                border-color: rgba(237, 237, 237, 0.18);
                color: #ededed;
              }
              .cg-tabs {
                display: flex;
                gap: 20px;
                padding: 0 20px;
                border-bottom: 1px solid rgba(237, 237, 237, 0.08);
              }
              .cg-tab-btn {
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                color: #85858b;
                font-size: 13px;
                font-weight: 500;
                padding: 12px 2px;
                cursor: pointer;
                transition: color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-tab-btn:hover {
                color: #ededed;
              }
              .cg-tab-btn.active {
                color: #ededed;
                border-bottom-color: #38bdf8;
              }
              .cg-modal-body {
                padding: 16px 20px 20px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 16px;
              }
              .cg-summary-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 12px;
                padding: 12px 0;
              }
              .cg-summary-cell {
                padding: 0 16px;
                border-right: 1px solid rgba(237, 237, 237, 0.08);
              }
              .cg-summary-cell:last-child {
                border-right: none;
              }
              .cg-summary-label {
                font-size: 12px;
                color: #85858b;
                margin-bottom: 4px;
              }
              .cg-summary-val {
                font-size: 24px;
                font-weight: 500;
                color: #ededed;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                font-family: ui-sans-serif, system-ui, sans-serif;
              }
              .cg-summary-unit {
                font-size: 12px;
                font-weight: 400;
                color: #85858b;
                margin-left: 4px;
              }
              .cg-panel {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 12px;
                padding: 16px;
              }
              .cg-panel-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
                gap: 12px;
                flex-wrap: wrap;
              }
              .cg-panel-title {
                font-size: 14px;
                font-weight: 500;
                color: #ededed;
              }
              .cg-panel-sub {
                font-size: 12px;
                color: #85858b;
                margin-top: 2px;
                font-variant-numeric: tabular-nums;
              }
              .cg-seg-group {
                display: inline-flex;
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.1);
                border-radius: 8px;
                overflow: hidden;
              }
              .cg-seg-btn {
                background: transparent;
                border: none;
                color: #85858b;
                font-size: 12px;
                font-weight: 500;
                padding: 4px 12px;
                cursor: pointer;
                transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-seg-btn.active {
                background: #232325;
                color: #ededed;
              }
              .cg-select {
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.12);
                color: #ededed;
                font-size: 12px;
                font-weight: 500;
                border-radius: 8px;
                padding: 4px 8px;
                cursor: pointer;
              }
              .cg-heatmap-scroll {
                overflow-x: auto;
                padding-bottom: 4px;
              }
              .cg-heatmap-months {
                display: grid;
                margin-left: 24px;
                font-size: 11px;
                color: #85858b;
                margin-bottom: 4px;
              }
              .cg-heatmap-main {
                display: flex;
                gap: 8px;
                align-items: flex-start;
              }
              .cg-heatmap-days {
                display: grid;
                grid-template-rows: repeat(7, 11px);
                gap: 3px;
                font-size: 10px;
                color: #85858b;
                width: 16px;
                text-align: right;
              }
              .cg-heatmap-grid {
                display: grid;
                grid-auto-flow: column;
                grid-template-rows: repeat(7, 11px);
                gap: 3px;
              }
              .cg-heat-cell {
                width: 11px;
                height: 11px;
                border-radius: 2px;
                background: rgba(237, 237, 237, 0.06);
                cursor: pointer;
                transition: outline-color 0.12s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-heat-cell:hover {
                outline: 1.5px solid #a1a1a6;
              }
              .cg-heat-cell.selected {
                outline: 1.5px solid #ededed;
              }
              .cg-heat-l1 { background: #1c3244; }
              .cg-heat-l2 { background: #1f4f73; }
              .cg-heat-l3 { background: #2274a5; }
              .cg-heat-l4 { background: #38bdf8; }
              .cg-heatmap-foot {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 11px;
                color: #85858b;
                margin-top: 8px;
                font-variant-numeric: tabular-nums;
              }
              .cg-selected-banner {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 10px;
                padding: 12px 16px;
                display: flex;
                align-items: center;
                justify-content: space-between;
              }
              .cg-link-btn {
                background: transparent;
                border: none;
                color: #38bdf8;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
              }
              .cg-link-btn:hover {
                color: #7dd3fc;
                text-decoration: underline;
              }
              .cg-legend {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin-bottom: 12px;
              }
              .cg-legend-item {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: #a1a1a6;
                cursor: pointer;
                padding: 2px 6px;
                border-radius: 6px;
                transition: opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-legend-item:hover {
                background: #232325;
                color: #ededed;
              }
              .cg-legend-item.muted {
                opacity: 0.35;
              }
              .cg-legend-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                display: inline-block;
              }
              .cg-chart-area {
                position: relative;
                height: 192px;
                display: flex;
                flex-direction: column;
                margin-top: 4px;
              }
              .cg-chart-plot {
                position: relative;
                flex: 1;
                margin-left: 48px;
                border-bottom: 1px solid rgba(237, 237, 237, 0.14);
                display: flex;
                align-items: flex-end;
                gap: 4px;
                padding: 0 4px;
              }
              .cg-y-grid {
                position: absolute;
                left: -48px;
                right: 0;
                border-top: 1px dashed rgba(237, 237, 237, 0.08);
                pointer-events: none;
              }
              .cg-y-label {
                position: absolute;
                top: -7px;
                left: 0;
                width: 40px;
                text-align: right;
                font-size: 10px;
                color: #85858b;
                font-variant-numeric: tabular-nums;
              }
              .cg-bar-col {
                flex: 1;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: flex-end;
                align-items: center;
                cursor: pointer;
                position: relative;
                z-index: 2;
              }
              .cg-bar-stack {
                width: min(20px, 76%);
                display: flex;
                flex-direction: column-reverse;
                border-radius: 3px 3px 0 0;
                overflow: hidden;
                transition: opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-bar-col:hover .cg-bar-stack {
                opacity: 0.85;
              }
              .cg-x-axis {
                margin-left: 48px;
                display: flex;
                padding: 6px 4px 0;
                font-size: 10px;
                color: #85858b;
                font-variant-numeric: tabular-nums;
              }
              .cg-x-tick {
                flex: 1;
                text-align: center;
                white-space: nowrap;
              }
              .cg-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
                margin-top: 4px;
              }
              .cg-table th {
                text-align: right;
                color: #85858b;
                font-weight: 500;
                font-size: 11px;
                padding: 8px 12px;
                border-bottom: 1px solid rgba(237, 237, 237, 0.1);
              }
              .cg-table th:first-child {
                text-align: left;
              }
              .cg-table td {
                text-align: right;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(237, 237, 237, 0.06);
                color: #ededed;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                transition: background-color 0.12s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .cg-table tbody tr:hover td {
                background: #232325;
              }
              .cg-table td:first-child {
                text-align: left;
                font-family: inherit;
                font-weight: 500;
              }
              .cg-quota-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                gap: 12px;
              }
              .cg-quota-card {
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 12px;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
              }
              .cg-quota-card.is-active-pool {
                border-color: rgba(56, 189, 248, 0.45);
              }
              .cg-quota-card-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
              }
              .cg-quota-name {
                font-size: 14px;
                font-weight: 600;
                color: #ededed;
              }
              .cg-quota-desc {
                font-size: 11px;
                color: #85858b;
                line-height: 1.45;
              }
              .cg-quota-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 12px;
                background: #19191b;
                border-radius: 8px;
                border: 1px solid rgba(237, 237, 237, 0.06);
              }
              .cg-quota-ring-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
                font-variant-numeric: tabular-nums;
              }
              .cg-tooltip {
                position: fixed;
                z-index: 100000030;
                pointer-events: none;
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.16);
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 11px;
                color: #ededed;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
                display: none;
                font-variant-numeric: tabular-nums;
              }

              /* 右键原生级卡片菜单（Graphite 中性阶 + 4px 栅格 + 智能侧边避让） */
              #antigravity-catgirl-contextmenu {
                position: fixed;
                z-index: 100000000;
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.12);
                border-radius: 12px;
                padding: 8px;
                width: 252px;
                min-width: 240px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
                font-size: 12px;
                color: #ededed;
                display: none;
                user-select: none;
                max-height: calc(100vh - 32px);
                overflow-y: auto;
                overflow-x: hidden;
                scrollbar-width: thin;
                scrollbar-color: rgba(237, 237, 237, 0.18) transparent;
              }
              #antigravity-catgirl-contextmenu::-webkit-scrollbar {
                width: 4px;
              }
              #antigravity-catgirl-contextmenu::-webkit-scrollbar-thumb {
                background: rgba(237, 237, 237, 0.18);
                border-radius: 4px;
              }
              .catgirl-input-wrap {
                display: flex;
                align-items: center;
                background: #232325;
                border: 1px solid rgba(237, 237, 237, 0.14);
                border-radius: 4px;
                padding: 2px 6px;
                transition: border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .catgirl-input-wrap:focus-within {
                background: #27272a;
                border-color: #38bdf8;
              }
              .catgirl-number-input {
                width: 34px;
                background: transparent;
                border: none;
                color: #ededed;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-variant-numeric: tabular-nums;
                font-size: 11px;
                font-weight: 500;
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
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 10px;
                color: #85858b;
                margin-left: 2px;
                font-weight: 500;
              }

              /* 正在运行的任务列表样式 */
              #running-tasks-count-badge {
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 4px;
                background: #232325;
                border: 1px solid rgba(237, 237, 237, 0.08);
                color: #85858b;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
              }
              #running-tasks-count-badge.is-running {
                border-color: rgba(56, 189, 248, 0.35);
                color: #38bdf8;
              }
              .catgirl-tasks-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin-top: 6px;
                max-height: 108px;
                overflow-y: auto;
              }
              .catgirl-task-item {
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 6px;
                padding: 6px 8px;
                display: flex;
                flex-direction: column;
                gap: 2px;
                cursor: pointer;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
                user-select: none;
                position: relative;
              }
              .catgirl-task-item:hover {
                background: #232325;
                border-color: rgba(56, 189, 248, 0.45);
              }
              .catgirl-task-item:active {
                transform: scale(0.98);
              }
              .catgirl-task-arrow {
                margin-left: auto;
                font-size: 11px;
                color: #85858b;
                transition: color 0.15s cubic-bezier(0.22, 1, 0.36, 1), transform 0.15s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .catgirl-task-item:hover .catgirl-task-arrow {
                color: #38bdf8;
                transform: translateX(2px);
              }
              .catgirl-task-top {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                font-weight: 500;
                color: #ededed;
              }
              .catgirl-task-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #38bdf8;
                flex-shrink: 0;
              }
              .catgirl-task-ws {
                font-size: 10px;
                padding: 1px 4px;
                border-radius: 4px;
                background: #232325;
                color: #a1a1a6;
                flex-shrink: 0;
                max-width: 68px;
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
                color: #85858b;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-left: 12px;
              }
              .catgirl-task-empty {
                font-size: 10.5px;
                color: #85858b;
                text-align: center;
                padding: 6px 8px;
                background: #141415;
                border-radius: 6px;
              }

              /* 动作姿态切换网格 */
              .catgirl-action-grid {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 4px;
                margin-top: 6px;
              }
              .catgirl-action-btn, .catgirl-egg-btn {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 6px 2px;
                gap: 3px;
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 6px;
                cursor: pointer;
                transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), color 0.14s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
                font-size: 10px;
                color: #a1a1a6;
              }
              .catgirl-action-btn:hover, .catgirl-egg-btn:hover {
                background: #232325;
                border-color: rgba(237, 237, 237, 0.2);
                color: #ededed;
              }
              .catgirl-action-btn.active, .catgirl-egg-btn.active {
                background: #232325;
                border-color: rgba(56, 189, 248, 0.5);
                color: #38bdf8;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
                font-weight: 500;
              }
              .catgirl-action-btn:active, .catgirl-egg-btn:active {
                transform: scale(0.97);
              }
              .catgirl-action-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
              }
              #action-current-badge {
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 4px;
                background: #232325;
                border: 1px solid rgba(237, 237, 237, 0.1);
                color: #ededed;
                font-weight: 500;
              }

              /* 待机随机动作（直接平铺，取消虚线套娃） */
              .catgirl-egg-box {
                margin-top: 8px;
                padding-top: 8px;
                border-top: 1px solid rgba(237, 237, 237, 0.06);
              }
              .catgirl-egg-header {
                font-size: 10px;
                color: #85858b;
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 4px;
                font-weight: 500;
              }
              .catgirl-egg-grid {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 4px;
              }

              /* 自由调节大小滑块卡片 */
              .catgirl-slider-box {
                padding: 8px;
                background: #19191b;
                border-radius: 8px;
                margin-bottom: 8px;
                border: 1px solid rgba(237, 237, 237, 0.08);
              }
              .catgirl-slider-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 11px;
                font-weight: 500;
                margin-bottom: 4px;
                color: #ededed;
              }
              .catgirl-slider-header-left {
                display: flex;
                align-items: center;
                gap: 6px;
              }
              .catgirl-icon-slot {
                width: 16px;
                height: 16px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: #85858b;
                flex-shrink: 0;
              }
              .catgirl-slider {
                width: 100%;
                height: 4px;
                border-radius: 2px;
                background: rgba(237, 237, 237, 0.14);
                outline: none;
                cursor: pointer;
                accent-color: #38bdf8;
                margin: 4px 0 8px 0;
              }
              .catgirl-preset-row {
                display: flex;
                gap: 4px;
              }
              .catgirl-preset-btn {
                flex: 1;
                text-align: center;
                padding: 3px 0;
                font-size: 10px;
                font-weight: 500;
                font-variant-numeric: tabular-nums;
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.08);
                color: #a1a1a6;
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .catgirl-preset-btn:hover {
                background: #232325;
                color: #ededed;
              }
              .catgirl-preset-btn.active {
                background: #232325;
                border-color: rgba(56, 189, 248, 0.5);
                color: #38bdf8;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
              }

              /* 远程更新检测卡片与按钮 */
              .catgirl-update-box {
                background: #19191b;
                border: 1px solid rgba(237, 237, 237, 0.08);
                border-radius: 8px;
                padding: 8px;
                margin-bottom: 8px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                box-sizing: border-box;
              }
              .catgirl-update-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
              }
              .catgirl-version-tag {
                font-size: 10px;
                padding: 1px 6px;
                border-radius: 4px;
                background: #232325;
                border: 1px solid rgba(237, 237, 237, 0.1);
                color: #a1a1a6;
                font-weight: 500;
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-variant-numeric: tabular-nums;
              }
              .catgirl-update-check-btn {
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.12);
                color: #ededed;
                font-size: 10px;
                font-weight: 500;
                border-radius: 4px;
                padding: 3px 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 4px;
                transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .catgirl-update-check-btn:hover {
                background: #232325;
                border-color: rgba(237, 237, 237, 0.24);
              }
              .catgirl-update-detail {
                font-size: 10px;
                line-height: 1.4;
                color: #a1a1a6;
                background: #141415;
                border: 1px solid rgba(237, 237, 237, 0.06);
                border-radius: 6px;
                padding: 6px 8px;
                display: flex;
                flex-direction: column;
                gap: 6px;
              }
              .catgirl-upgrade-action-btn {
                background: #ededed;
                border: none;
                color: #141415;
                font-size: 11px;
                font-weight: 600;
                border-radius: 6px;
                padding: 5px 8px;
                cursor: pointer;
                transition: background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
              }
              .catgirl-upgrade-action-btn:hover {
                background: #ffffff;
              }
              .catgirl-upgrade-action-btn:active {
                transform: scale(0.98);
              }
              .catgirl-upgrade-action-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
              }
              @keyframes catgirl-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              .catgirl-spinning {
                animation: catgirl-spin 0.8s linear infinite;
                display: inline-flex;
              }

              .catgirl-menu-item {
                padding: 6px 8px;
                border-radius: 6px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: #ededed;
                transition: background-color 0.14s cubic-bezier(0.22, 1, 0.36, 1);
              }
              .catgirl-menu-item:hover {
                background: #232325;
              }
              .catgirl-menu-divider {
                height: 1px;
                background: rgba(237, 237, 237, 0.08);
                margin: 4px 2px;
              }
            \`;

            // 统一 1.5px 线性 SVG 图标集（替代全界面 Emoji）
            const svgIcon = (paths, size = 14) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
            const CG_ICONS = {
              gauge: svgIcon('<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>', 14),
              close: svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 13),
              bolt: svgIcon('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', 12),
              activity: svgIcon('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', 13),
              terminal: svgIcon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', 13),
              sliders: svgIcon('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>', 13),
              refresh: svgIcon('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', 12),
              pin: svgIcon('<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>', 13),
              target: svgIcon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>', 13),
              power: svgIcon('<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>', 13),
              chevronRight: svgIcon('<polyline points="9 18 15 12 9 6"/>', 12),
              // 姿态与角标 12px 线性图标
              idle: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>', 12),
              coding: svgIcon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', 12),
              thinking: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 12),
              celebrate: svgIcon('<polyline points="20 6 9 17 4 12"/>', 12),
              warning: svgIcon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 12),
              wave: svgIcon('<path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>', 12),
              starry: svgIcon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 12),
              cheerful: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>', 12),
              shy: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M9 15h6"/><line x1="9" y1="10" x2="9.01" y2="10"/><line x1="15" y1="10" x2="15.01" y2="10"/>', 12),
              confused: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 12),
              fail: svgIcon('<circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>', 12)
            };

            // 挂载 DOM 结构
            const dock = document.createElement('div');
            dock.id = 'antigravity-catgirl-dock';
            dock.innerHTML = \`
              <div id="catgirl-body" title="左键单击互动，长按拖动，双击或点击胶囊展开 Token 仪表盘">
                <div id="catgirl-bubble-wrap">
                  <div id="catgirl-bubble-box">右键可调整大小或切换动作，双击展开用量</div>
                  <div id="catgirl-bubble-arrow"></div>
                </div>
                <div id="catgirl-anim-stage">
                  <div id="catgirl-ground-shadow"></div>
                  <img id="catgirl-img" src="\${IMAGES.idle}" alt="AI Buddy Gemini" style="width: 110px; height: 100%; object-fit: contain; pointer-events: none; user-select: none;" />
                  <video id="catgirl-video-a" class="catgirl-video-layer" autoplay loop muted playsinline preload="auto"></video>
                  <video id="catgirl-video-b" class="catgirl-video-layer" autoplay loop muted playsinline preload="auto"></video>
                  <canvas id="catgirl-canvas"></canvas>
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
                  </div>
                  <div id="catgirl-status-badge">\${CG_ICONS.idle}</div>
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
                    <span id="live-pill-quota-badge" class="pill-badge pill-badge-quota">5h --</span>
                    <span id="live-pill-model-badge" class="pill-badge pill-badge-model">Gemini</span>
                  </div>
                  <span id="live-catgirl-token-text" style="display:none;"></span>
                </div>
              </div>

              <!-- 猫娘专属实时 Token & 额度看板 HUD -->
              <div id="catgirl-dashboard-hud" class="hud-hidden">
                <div class="hud-header">
                  <div class="hud-title-box">
                    <span class="hud-title-icon">\${CG_ICONS.gauge}</span>
                    <span class="hud-title">星星猫娘 · Token 仪表盘</span>
                  </div>
                  <div class="hud-actions">
                    <button id="live-hud-close-btn" class="hud-btn-icon" title="关闭看板">\${CG_ICONS.close}</button>
                  </div>
                </div>
                <div class="hud-section">
                  <div class="hud-section-title">
                    <div class="hud-section-title-left">
                      <span>额度剩余</span>
                      <button id="live-hud-quota-group-btn" class="hud-group-pill" title="实时联动当前生效的模型配额池，点击可即时刷新">
                        <span class="hud-live-indicator-dot" style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#4cc38a;"></span>
                        <span id="live-hud-quota-group-name">Gemini Models</span>
                        <span style="font-size: 9px; color: #85858b;">实时</span>
                      </button>
                    </div>
                    <span class="hud-subtle" id="live-hud-quota-status" style="color: #4cc38a; font-size: 11px;">正常</span>
                  </div>
                  <div class="hud-quota-switcher" id="live-hud-quota-switcher">
                    <button class="hud-quota-tab active" data-pool="auto" title="自动跟随当前对话模型">自动</button>
                    <button class="hud-quota-tab" data-pool="gemini" title="查看 Gemini 模型额度">Gemini</button>
                    <button class="hud-quota-tab" data-pool="3p" title="查看 Claude / GPT 额度">Claude/GPT</button>
                    <button class="hud-quota-tab" data-pool="gemini-argon-wtu" title="查看 Gemini 4 Argon 额度">Argon</button>
                    <button class="hud-quota-tab" id="live-hud-all-quotas-btn" style="margin-left:auto; color:#a1a1a6;" title="同时查看全部模型池额度">全部 ›</button>
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
                  <div class="hud-gauge-row" style="margin-bottom: 0;">
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
                    <div class="hud-section-title-left">
                      <span>上下文占用</span>
                      <span id="live-hud-model-tag" class="hud-badge" title="当前对话使用的 AI 模型">Gemini</span>
                    </div>
                    <span class="hud-badge" id="live-hud-ctx-badge">0% 已用</span>
                  </div>
                  <div class="hud-track">
                    <div class="hud-fill hud-fill-ctx" id="live-hud-ctx-bar" style="width: 0%;"></div>
                  </div>
                  <div class="hud-timer-row">
                    <span id="live-hud-ctx-tokens">-- / 256K tok</span>
                    <span id="live-hud-ctx-hint" style="color: #4cc38a; font-size: 10px;">上下文正常</span>
                  </div>
                </div>
                <div class="hud-section">
                  <div class="hud-section-title">
                    <span class="hud-section-title-left">Token 消耗</span>
                    <button id="live-hud-open-analytics-btn" class="hud-analytics-entry-btn" title="打开活动热力图、按模型用量统计与全模型额度">
                      <span>用量与全额度</span>
                      \${CG_ICONS.chevronRight}
                    </button>
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
                    <div class="hud-metric-card" style="grid-column: span 2; flex-direction: row; align-items: center; justify-content: space-between; padding: 8px;" title="当前所在对话框从开始至今累计消耗的 Token 总量">
                      <span class="hud-metric-label">本对话累计总量 <span id="live-hud-conv-req" style="color: #a1a1a6; font-size: 10px;"></span></span>
                      <span class="hud-metric-val" id="live-hud-conv-total-val" style="color: #38bdf8;">--</span>
                    </div>
                  </div>
                </div>
                <div class="hud-footer" id="live-hud-footer">
                  <button id="live-hud-open-full-dashboard" class="hud-btn-primary">
                    <span>打开外部 Dashboard</span>
                  </button>
                </div>
              </div>
            \`;
            document.body.appendChild(dock);
            const detachedHudEl = document.getElementById('catgirl-dashboard-hud');
            if (detachedHudEl) {
              document.body.appendChild(detachedHudEl);
            }

            // 右键控制面板：4px 栅格、线性图标、智能侧边避让
            const menu = document.createElement('div');
            menu.id = 'antigravity-catgirl-contextmenu';
            menu.innerHTML = \`
              <div class="catgirl-menu-item" id="menu-dashboard" style="font-weight: 500;">
                <span class="catgirl-icon-slot" style="color: #38bdf8;">\${CG_ICONS.gauge}</span> <span>Token 用量与额度看板</span>
              </div>
              <div class="catgirl-menu-divider"></div>

              <!-- 实时正在运行的任务列表卡片 -->
              <div class="catgirl-slider-box" id="menu-running-tasks-card">
                <div class="catgirl-slider-header" style="margin-bottom: 4px;">
                  <span class="catgirl-slider-header-left"><span class="catgirl-icon-slot">\${CG_ICONS.activity}</span> 正在运行的任务</span>
                  <span id="running-tasks-count-badge">空闲待机</span>
                </div>
                <div id="running-tasks-list" class="catgirl-tasks-list">
                  <div class="catgirl-task-empty">当前无运行中任务</div>
                </div>
              </div>
              
              <!-- 动作姿态切换卡片 -->
              <div class="catgirl-slider-box" id="menu-action-card">
                <div class="catgirl-slider-header">
                  <span class="catgirl-slider-header-left"><span class="catgirl-icon-slot">\${CG_ICONS.terminal}</span> 姿态与动作</span>
                  <span id="action-current-badge">待机</span>
                </div>
                <div class="catgirl-action-grid">
                  <div class="catgirl-action-btn active" data-action="idle" title="待机（无任务运行时自动呈现）">
                    <span class="catgirl-action-icon">\${CG_ICONS.idle}</span>
                    <span>待机</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="coding" title="敲码（任务运行中自动呈现）">
                    <span class="catgirl-action-icon">\${CG_ICONS.coding}</span>
                    <span>敲码</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="thinking" title="思考（托腮沉思姿态）">
                    <span class="catgirl-action-icon">\${CG_ICONS.thinking}</span>
                    <span>思考</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="celebrate" title="庆祝（任务交付时呈现）">
                    <span class="catgirl-action-icon">\${CG_ICONS.celebrate}</span>
                    <span>庆祝</span>
                  </div>
                  <div class="catgirl-action-btn" data-action="warning" title="预警（上下文达 80% 时呈现）">
                    <span class="catgirl-action-icon">\${CG_ICONS.warning}</span>
                    <span>预警</span>
                  </div>
                </div>

                <!-- 待机随机动作预览 -->
                <div class="catgirl-egg-box">
                  <div class="catgirl-egg-header">
                    <span>待机动作</span>
                    <span>自动轮换</span>
                  </div>
                  <div class="catgirl-egg-grid">
                    <div class="catgirl-egg-btn" data-egg="wave" title="挥手">
                      <span class="catgirl-action-icon">\${CG_ICONS.wave}</span>
                      <span>挥手</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="starry" title="崇拜">
                      <span class="catgirl-action-icon">\${CG_ICONS.starry}</span>
                      <span>崇拜</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="cheerful" title="开心">
                      <span class="catgirl-action-icon">\${CG_ICONS.cheerful}</span>
                      <span>开心</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="shy" title="害羞">
                      <span class="catgirl-action-icon">\${CG_ICONS.shy}</span>
                      <span>害羞</span>
                    </div>
                    <div class="catgirl-egg-btn" data-egg="confused" title="困惑">
                      <span class="catgirl-action-icon">\${CG_ICONS.confused}</span>
                      <span>困惑</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="catgirl-slider-box" id="menu-slider-card">
                <div class="catgirl-slider-header">
                  <span class="catgirl-slider-header-left"><span class="catgirl-icon-slot">\${CG_ICONS.sliders}</span> 缩放比例</span>
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

              <!-- 远程更新检测与一键配置卡片 -->
              <div class="catgirl-update-box" id="menu-update-card">
                <div class="catgirl-update-header">
                  <div class="catgirl-slider-header-left">
                    <span class="catgirl-icon-slot">\${CG_ICONS.bolt}</span>
                    <span style="font-weight: 500; font-size: 11px;">版本状态</span>
                    <span id="pet-version-tag" class="catgirl-version-tag">v1.2.1</span>
                  </div>
                  <button id="pet-check-update-btn" class="catgirl-update-check-btn" title="检查 GitHub 远程版本">
                    <span id="pet-update-icon">\${CG_ICONS.refresh}</span>
                    <span id="pet-check-btn-text">检查更新</span>
                  </button>
                </div>
                <div id="pet-update-status-detail" class="catgirl-update-detail" style="display: none;"></div>
              </div>

              <div class="catgirl-menu-item" id="menu-ontop">
                <span class="catgirl-icon-slot">\${CG_ICONS.pin}</span> <span id="ontop-text">置顶开关: 开</span>
              </div>
              <div class="catgirl-menu-item" id="menu-reset">
                <span class="catgirl-icon-slot">\${CG_ICONS.target}</span> <span>归位右下角</span>
              </div>
              <div class="catgirl-menu-divider"></div>
              <div class="catgirl-menu-item" id="menu-close" style="color: #e5484d;">
                <span class="catgirl-icon-slot" style="color: #e5484d;">\${CG_ICONS.power}</span> <span>关闭挂件</span>
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
            const canvasEl = document.getElementById('catgirl-canvas');
            const canvasCtx = canvasEl ? canvasEl.getContext('2d', { alpha: true }) : null;
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
              '{ }', '( )', '=>', '[ ]', ';', '()', '::', 'const', 'return', 'fn()'
            ];
            const CODE_COLORS = [
              '#a1a1a6', '#d4d4d8', '#38bdf8'
            ];

            function spawnCodeParticle(side) {
              if (!codeParticles) return;
              if (codeParticles.children.length >= 5) return;

              const text = CODE_SNIPPETS[Math.floor(Math.random() * CODE_SNIPPETS.length)];
              const color = CODE_COLORS[Math.floor(Math.random() * CODE_COLORS.length)];
              const p = document.createElement('div');
              p.className = 'code-particle';
              p.textContent = text;
              p.style.color = color;

              // 精准在左手或右手敲击指尖处生成字符
              let leftPercent;
              if (side === 'left') {
                leftPercent = 28 + Math.random() * 16;
              } else if (side === 'right') {
                leftPercent = 56 + Math.random() * 16;
              } else {
                leftPercent = 32 + Math.random() * 36;
              }
              const dx = (Math.random() - 0.5) * 16;
              p.style.left = leftPercent.toFixed(1) + '%';
              p.style.bottom = '36px';
              p.style.setProperty('--p-dx', dx.toFixed(1) + 'px');

              codeParticles.appendChild(p);
              setTimeout(() => {
                if (p.parentNode) p.remove();
              }, 900);
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

            // 内存级 Blob 预加载缓存池 + WebCodecs/IndexedDB 60fps 精灵图帧缓存渲染引擎（0 掉帧、0 循环卡顿、0 切换延迟）
            window.__catgirl_video_blobs = window.__catgirl_video_blobs || {};
            window.__catgirl_video_promises = window.__catgirl_video_promises || {};

            const SPRITE_CACHE_DB = 'catgirl_sprite_cache_v3';
            const SPRITE_STORE = 'sheets';
            const SPRITE_W = 384;
            const SPRITE_H = 416;
            const SPRITE_COLS = 18;
            const SPRITE_FPS_FALLBACK = 60;
            const MAX_DECODED_SHEETS = 2;

            const bitmapLRU = new Map(); // folder -> { bmp, cols, frameW, frameH, frameCount, fps }
            const sheetPromises = new Map();
            const idbAvailMap = new Map(); // folder -> boolean
            let spriteDbPromise = null;
            let spriteWorker = null;
            let spriteWorkerUrl = null;
            let spriteBakeQueue = Promise.resolve();
            let activeSpriteFolder = null;
            let activeSpriteEntry = null;
            let canvasMode = false;
            let spritePlayStart = 0;
            let lastDrawnFrameIdx = -1;
            let spriteRafId = 0;
            let spriteDisposed = false;

            function openSpriteDb() {
              if (spriteDbPromise) return spriteDbPromise;
              spriteDbPromise = new Promise((resolve) => {
                try {
                  if (typeof indexedDB === 'undefined') { resolve(null); return; }
                  try { indexedDB.deleteDatabase('catgirl_sprite_cache_v1'); } catch (e) {}
                  try { indexedDB.deleteDatabase('catgirl_sprite_cache_v2'); } catch (e) {}
                  const req = indexedDB.open(SPRITE_CACHE_DB, 1);
                  req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(SPRITE_STORE)) {
                      db.createObjectStore(SPRITE_STORE);
                    }
                  };
                  req.onsuccess = () => resolve(req.result);
                  req.onerror = () => resolve(null);
                } catch (e) { resolve(null); }
              });
              return spriteDbPromise;
            }

            async function idbGetSheet(folder) {
              const db = await openSpriteDb();
              if (!db) return null;
              return new Promise((resolve) => {
                try {
                  const tx = db.transaction(SPRITE_STORE, 'readonly');
                  const req = tx.objectStore(SPRITE_STORE).get(folder);
                  req.onsuccess = () => resolve(req.result || null);
                  req.onerror = () => resolve(null);
                } catch (e) { resolve(null); }
              });
            }

            async function idbPutSheet(folder, record) {
              const db = await openSpriteDb();
              if (!db) return;
              return new Promise((resolve) => {
                try {
                  const tx = db.transaction(SPRITE_STORE, 'readwrite');
                  tx.objectStore(SPRITE_STORE).put(record, folder);
                  tx.oncomplete = () => resolve();
                  tx.onerror = () => resolve();
                } catch (e) { resolve(); }
              });
            }

            function touchBitmapLRU(folder, entry) {
              if (bitmapLRU.has(folder)) {
                bitmapLRU.delete(folder);
              }
              bitmapLRU.set(folder, entry);
              while (bitmapLRU.size > MAX_DECODED_SHEETS) {
                let evictKey = null;
                for (const k of bitmapLRU.keys()) {
                  if (k !== 'idle' && k !== activeSpriteFolder && k !== folder) {
                    evictKey = k;
                    break;
                  }
                }
                if (!evictKey) break;
                const old = bitmapLRU.get(evictKey);
                bitmapLRU.delete(evictKey);
                try { if (old && old.bmp && old.bmp.close) old.bmp.close(); } catch (e) {}
              }
            }

            function catgirlSpriteWorkerBootstrap() {
              function parseWebmPackets(buf) {
                const len = buf.length;
                function readVint(pos) {
                  const b = buf[pos]; let mask = 0x80, l = 1;
                  while (l <= 8 && !(b & mask)) { mask >>= 1; l++; }
                  let val = b & (mask - 1);
                  for (let i = 1; i < l; i++) val = (val * 256) + buf[pos + i];
                  return [val, pos + l];
                }
                function readId(pos) {
                  const b = buf[pos]; let mask = 0x80, l = 1;
                  while (l <= 4 && !(b & mask)) { mask >>= 1; l++; }
                  let val = 0;
                  for (let i = 0; i < l; i++) val = (val * 256) + buf[pos + i];
                  return [val, pos + l];
                }
                const frames = [];
                let pos = 0;
                while (pos < len - 4) {
                  let idx = -1;
                  for (let i = pos; i <= len - 4; i++) {
                    if (buf[i] === 0x1f && buf[i+1] === 0x43 && buf[i+2] === 0xb6 && buf[i+3] === 0x75) { idx = i; break; }
                  }
                  if (idx === -1) break;
                  const [sz, start] = readVint(idx + 4);
                  const end = Math.min(len, start + sz);
                  let p = start, cts = 0;
                  while (p < end) {
                    const [eid, np] = readId(p);
                    const [esz, dp] = readVint(np);
                    if (eid === 0xE7) {
                      cts = 0; for (let k = 0; k < esz; k++) cts = (cts * 256) + buf[dp + k];
                    } else if (eid === 0xA0) {
                      let sp = dp, send = dp + esz, color = null, alpha = null, hasRef = false, ts = 0;
                      while (sp < send) {
                        const [seid, snp] = readId(sp);
                        const [sesz, sdp] = readVint(snp);
                        if (seid === 0xA1) {
                          const [, bp] = readVint(sdp);
                          ts = cts + ((buf[bp] << 24 >> 16) | buf[bp+1]);
                          color = buf.subarray(bp + 3, sdp + sesz);
                        } else if (seid === 0x75A1) {
                          let ap = sdp, aend = sdp + sesz;
                          while (ap < aend) {
                            const [aeid, anp] = readId(ap);
                            const [aesz, adp] = readVint(anp);
                            if (aeid === 0xA6) {
                              let mp = adp, mend = adp + aesz;
                              while (mp < mend) {
                                const [meid, mnp] = readId(mp);
                                const [mesz, mdp] = readVint(mnp);
                                if (meid === 0xA5) alpha = buf.subarray(mdp, mdp + mesz);
                                mp = mdp + mesz;
                              }
                            }
                            ap = adp + aesz;
                          }
                        } else if (seid === 0xFB) {
                          hasRef = true;
                        }
                        sp = sdp + sesz;
                      }
                      if (color) frames.push({ ts, key: !hasRef, color, alpha });
                    }
                    p = dp + esz;
                  }
                  pos = idx + 4;
                }
                return frames;
              }

              let glState = null;
              function getGl(srcW, srcH) {
                if (glState) {
                  if (glState.glCanvas.width !== srcW || glState.glCanvas.height !== srcH) {
                    glState.glCanvas.width = srcW;
                    glState.glCanvas.height = srcH;
                  }
                  return glState;
                }
                const glCanvas = new OffscreenCanvas(srcW, srcH);
                const gl = glCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
                const nl = String.fromCharCode(10);
                const vsSrc = ['#version 300 es', 'const vec2 P[4]=vec2[](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(1,1));', 'out vec2 vUv;', 'void main(){vec2 p=P[gl_VertexID];vUv=vec2(p.x*0.5+0.5,0.5-p.y*0.5);gl_Position=vec4(p,0,1);}'].join(nl);
                const fsSrc = ['#version 300 es', 'precision mediump float;', 'in vec2 vUv;', 'uniform sampler2D uC,uA;', 'out vec4 o;', 'void main(){vec3 c=texture(uC,vUv).rgb;float a=texture(uA,vUv).r;o=vec4(c*a,a);}'].join(nl);
                function sh(t, s) { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; }
                const prog = gl.createProgram();
                gl.attachShader(prog, sh(gl.VERTEX_SHADER, vsSrc));
                gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsSrc));
                gl.linkProgram(prog); gl.useProgram(prog);
                const tC = gl.createTexture(), tA = gl.createTexture();
                for (const [i, t] of [[0, tC], [1, tA]]) {
                  gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                }
                gl.uniform1i(gl.getUniformLocation(prog, 'uC'), 0);
                gl.uniform1i(gl.getUniformLocation(prog, 'uA'), 1);
                glState = { glCanvas, gl, tC, tA };
                return glState;
              }

              self.onmessage = async (e) => {
                const { id, url, W, H, COLS } = e.data;
                try {
                  if (typeof VideoDecoder === 'undefined') throw new Error('NO_WEBCODECS');
                  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
                  const frames = parseWebmPackets(buf);
                  if (!frames.length) throw new Error('NO_FRAMES');
                  const rows = Math.ceil(frames.length / COLS);
                  const sheet = new OffscreenCanvas(COLS * W, rows * H);
                  const sctx = sheet.getContext('2d');
                  sctx.imageSmoothingEnabled = true;
                  sctx.imageSmoothingQuality = 'high';
                  const colorMap = new Map();
                  const alphaMap = new Map();
                  let drawn = 0;
                  let decErr = null;

                  function tryComposite(ts) {
                    const cf = colorMap.get(ts);
                    const af = alphaMap.get(ts);
                    if (!cf || af === undefined) return;
                    colorMap.delete(ts); alphaMap.delete(ts);
                    const idx = drawn++;
                    const srcW = cf.displayWidth || cf.codedWidth || W;
                    const srcH = cf.displayHeight || cf.codedHeight || H;
                    const { glCanvas, gl, tC, tA } = getGl(srcW, srcH);
                    gl.viewport(0, 0, srcW, srcH);
                    gl.clearColor(0, 0, 0, 0);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tC);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cf);
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tA);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, af);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                    const col = idx % COLS, row = Math.floor(idx / COLS);
                    sctx.drawImage(glCanvas, 0, 0, srcW, srcH, col * W, row * H, W, H);
                    cf.close(); af.close();
                  }

                  const decC = new VideoDecoder({ output: (f) => { colorMap.set(f.timestamp, f); tryComposite(f.timestamp); }, error: (err) => { decErr = err; } });
                  const decA = new VideoDecoder({ output: (f) => { alphaMap.set(f.timestamp, f); tryComposite(f.timestamp); }, error: (err) => { decErr = err; } });
                  decC.configure({ codec: 'vp09.00.10.08', hardwareAcceleration: 'prefer-hardware' });
                  decA.configure({ codec: 'vp09.00.10.08', hardwareAcceleration: 'prefer-hardware' });
                  for (const f of frames) {
                    decC.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: f.ts * 1000, data: f.color }));
                    if (f.alpha) decA.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: f.ts * 1000, data: f.alpha }));
                  }
                  await Promise.all([decC.flush(), decA.flush()]);
                  decC.close(); decA.close();
                  if (decErr) throw decErr;
                  const blob = await sheet.convertToBlob({ type: 'image/webp', quality: 0.96 });
                  const firstTs = frames[0].ts || 0;
                  const lastTs = frames[frames.length - 1].ts || 5150;
                  const fps = Math.max(24, Math.min(60, Math.round(((frames.length - 1) * 1000) / Math.max(1, lastTs - firstTs))));
                  self.postMessage({ id, ok: true, blob, cols: COLS, frameW: W, frameH: H, frameCount: drawn, fps });
                } catch (err) {
                  self.postMessage({ id, ok: false, error: String(err) });
                }
              };
            }

            let workerMsgSeq = 0;
            const workerCallbacks = new Map();
            function getSpriteWorker() {
              if (spriteDisposed) return null;
              if (spriteWorker) return spriteWorker;
              try {
                const src = '(' + catgirlSpriteWorkerBootstrap.toString() + ')()';
                const b = new Blob([src], { type: 'application/javascript' });
                spriteWorkerUrl = URL.createObjectURL(b);
                spriteWorker = new Worker(spriteWorkerUrl);
                spriteWorker.onmessage = (ev) => {
                  const d = ev.data;
                  const cb = workerCallbacks.get(d.id);
                  if (cb) {
                    workerCallbacks.delete(d.id);
                    cb(d);
                  }
                };
                spriteWorker.onerror = () => {
                  for (const cb of workerCallbacks.values()) cb({ ok: false });
                  workerCallbacks.clear();
                };
              } catch (e) { spriteWorker = null; }
              return spriteWorker;
            }

            function bakeActionInWorker(actionKey, actionFolder) {
              const run = () => new Promise((resolve) => {
                if (spriteDisposed) { resolve(null); return; }
                const w = getSpriteWorker();
                if (!w) { resolve(null); return; }
                const id = ++workerMsgSeq;
                workerCallbacks.set(id, (res) => {
                  if (res && res.ok && res.blob) {
                    resolve({ blob: res.blob, cols: res.cols, frameW: res.frameW, frameH: res.frameH, frameCount: res.frameCount, fps: res.fps });
                  } else {
                    resolve(null);
                  }
                });
                w.postMessage({ id, url: getActionVideoUrl(actionKey), W: SPRITE_W, H: SPRITE_H, COLS: SPRITE_COLS });
              });
              const p = spriteBakeQueue.then(run, run);
              spriteBakeQueue = p.catch(() => null);
              return p;
            }

            function ensureSpriteEntry(actionKey) {
              const folder = AI_BUDDY_ACTIONS[actionKey] || actionKey;
              if (bitmapLRU.has(folder)) {
                const entry = bitmapLRU.get(folder);
                touchBitmapLRU(folder, entry);
                return Promise.resolve(entry);
              }
              if (sheetPromises.has(folder)) {
                return sheetPromises.get(folder);
              }
              const p = (async () => {
                let rec = await idbGetSheet(folder);
                if (!rec || !rec.blob) {
                  rec = await bakeActionInWorker(actionKey, folder);
                  if (rec && rec.blob && !spriteDisposed) {
                    idbAvailMap.set(folder, true);
                    idbPutSheet(folder, rec).catch(() => {});
                  }
                } else {
                  idbAvailMap.set(folder, true);
                }
                if (!rec || !rec.blob || spriteDisposed) return null;
                const bmp = await createImageBitmap(rec.blob);
                if (spriteDisposed) { try { bmp.close(); } catch (e) {} return null; }
                const entry = { bmp, cols: rec.cols || SPRITE_COLS, frameW: rec.frameW || SPRITE_W, frameH: rec.frameH || SPRITE_H, frameCount: rec.frameCount || 310, fps: rec.fps || SPRITE_FPS_FALLBACK };
                touchBitmapLRU(folder, entry);
                return entry;
              })().catch(() => null).finally(() => {
                sheetPromises.delete(folder);
              });
              sheetPromises.set(folder, p);
              return p;
            }

            function renderSpriteFrame(now) {
              if (!canvasMode || spriteDisposed || !canvasEl || !canvasCtx || !activeSpriteEntry) {
                spriteRafId = 0;
                return;
              }
              if (document.hidden) {
                spriteRafId = 0;
                return;
              }
              const entry = activeSpriteEntry;
              const effectiveScale = Math.max(1, (typeof currentScale === 'number' && !isNaN(currentScale)) ? currentScale : 1);
              const dpr = Math.min(4, (window.devicePixelRatio || 1) * effectiveScale);
              const targetW = Math.round(120 * dpr);
              const targetH = Math.round(135 * dpr);
              if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
                canvasEl.width = targetW;
                canvasEl.height = targetH;
                lastDrawnFrameIdx = -1;
              }
              const elapsed = Math.max(0, now - spritePlayStart);
              const frameIdx = Math.floor((elapsed * entry.fps) / 1000) % entry.frameCount;
              if (frameIdx !== lastDrawnFrameIdx) {
                if (!entry.bmp || !entry.bmp.width) {
                  // 位图已被释放：保留上一帧画面，重新从缓存解码当前动作，绝不画空
                  const lostFolder = activeSpriteFolder;
                  if (lostFolder && bitmapLRU.get(lostFolder) === entry) bitmapLRU.delete(lostFolder);
                  spriteRafId = 0;
                  if (lostFolder) {
                    ensureSpriteEntry(lostFolder).then((fresh) => {
                      if (fresh && activeSpriteFolder === lostFolder && !spriteDisposed) {
                        activeSpriteEntry = fresh;
                        lastDrawnFrameIdx = -1;
                        if (!spriteRafId) spriteRafId = requestAnimationFrame(renderSpriteFrame);
                      }
                    });
                  }
                  return;
                }
                lastDrawnFrameIdx = frameIdx;
                const col = frameIdx % entry.cols;
                const row = Math.floor(frameIdx / entry.cols);
                const scale = Math.min(targetW / entry.frameW, targetH / entry.frameH);
                const dw = entry.frameW * scale;
                const dh = entry.frameH * scale;
                const dx = (targetW - dw) * 0.5;
                const dy = (targetH - dh) * 0.5;
                canvasCtx.clearRect(0, 0, targetW, targetH);
                canvasCtx.imageSmoothingEnabled = true;
                canvasCtx.imageSmoothingQuality = 'high';
                try {
                  canvasCtx.drawImage(entry.bmp, col * entry.frameW, row * entry.frameH, entry.frameW, entry.frameH, dx, dy, dw, dh);
                } catch (e) {
                  lastDrawnFrameIdx = -1;
                }
              }
              spriteRafId = requestAnimationFrame(renderSpriteFrame);
            }

            function activateCanvasSprite(folder, entry, resetLoop) {
              if (!canvasEl || !entry || spriteDisposed) return false;
              const changedFolder = activeSpriteFolder !== folder;
              activeSpriteFolder = folder;
              activeSpriteEntry = entry;
              canvasMode = true;
              if (resetLoop || changedFolder) {
                spritePlayStart = performance.now();
                lastDrawnFrameIdx = -1;
              }
              canvasEl.style.display = 'block';
              canvasEl.style.opacity = '1';
              if (videoA) {
                videoA.style.opacity = '0';
                videoA.style.display = 'none';
                try { videoA.pause(); } catch (e) {}
              }
              if (videoB) {
                videoB.style.opacity = '0';
                videoB.style.display = 'none';
                try { videoB.pause(); } catch (e) {}
              }
              activeVideo = null;
              if (imgEl) {
                imgEl.style.opacity = '0';
                imgEl.style.display = 'none';
              }
              if (!spriteRafId) {
                spriteRafId = requestAnimationFrame(renderSpriteFrame);
              }
              return true;
            }

            function prewarmNextClickPose() {
              try {
                if (typeof IDLE_EASTER_EGGS !== 'undefined' && IDLE_EASTER_EGGS.length > 0) {
                  const nextKey = IDLE_EASTER_EGGS[interactionEggIndex % IDLE_EASTER_EGGS.length].act;
                  const folder = AI_BUDDY_ACTIONS[nextKey] || nextKey;
                  if (idbAvailMap.get(folder) && !bitmapLRU.has(folder)) {
                    ensureSpriteEntry(nextKey).catch(() => {});
                  }
                }
              } catch (e) {}
            }

            window.__catgirl_stop_sprite_engine = () => {
              spriteDisposed = true;
              canvasMode = false;
              if (spriteRafId) { cancelAnimationFrame(spriteRafId); spriteRafId = 0; }
              if (spriteWorker) { try { spriteWorker.terminate(); } catch (e) {} spriteWorker = null; }
              if (spriteWorkerUrl) { try { URL.revokeObjectURL(spriteWorkerUrl); } catch (e) {} spriteWorkerUrl = null; }
              workerCallbacks.clear();
              for (const entry of bitmapLRU.values()) {
                try { if (entry && entry.bmp && entry.bmp.close) entry.bmp.close(); } catch (e) {}
              }
              bitmapLRU.clear();
              if (spriteDbPromise) {
                spriteDbPromise.then(db => { try { if (db) db.close(); } catch (e) {} }).catch(() => {});
              }
            };

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
              const allKeys = ['idle', 'thinking', 'wave', 'starry', 'cheerful', 'shy', 'confused', 'celebrate', 'warning'];
              allKeys.forEach((k, idx) => {
                setTimeout(() => {
                  ensureSpriteEntry(k).then((entry) => {
                    const curFolder = AI_BUDDY_ACTIONS[currentAction] || currentAction;
                    if (entry && !canvasMode && (AI_BUDDY_ACTIONS[k] || k) === curFolder) {
                      activateCanvasSprite(curFolder, entry, false);
                    }
                    if (k === 'idle' && currentAction === 'idle') prewarmNextClickPose();
                  }).catch(() => {});
                }, idx * 80);
              });
            }

            function ensureActiveVideoPlaying() {
              if (canvasMode) {
                if (!document.hidden && !spriteRafId && activeSpriteEntry) {
                  lastDrawnFrameIdx = -1;
                  spriteRafId = requestAnimationFrame(renderSpriteFrame);
                }
                return;
              }
              if (activeVideo && activeVideo.style.opacity === '1' && activeVideo.paused) {
                const p = activeVideo.play();
                if (p) p.catch(() => {});
              }
            }

            if (videoA) {
              videoA.addEventListener('pause', () => {
                if (!canvasMode && activeVideo === videoA && videoA.style.opacity === '1') {
                  setTimeout(ensureActiveVideoPlaying, 30);
                }
              });
            }
            if (videoB) {
              videoB.addEventListener('pause', () => {
                if (!canvasMode && activeVideo === videoB && videoB.style.opacity === '1') {
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
              const resetLoop = (state !== 'idle' && state !== 'coding');

              // 1. 优先命中已解码的 60fps 精灵图（0.0ms 瞬时无缝切换）
              if (bitmapLRU.has(actionFolder)) {
                const entry = bitmapLRU.get(actionFolder);
                touchBitmapLRU(actionFolder, entry);
                activateCanvasSprite(actionFolder, entry, resetLoop);
                if (state === 'idle') prewarmNextClickPose();
                return;
              }

              // 若当前已处于 Canvas 流畅播放中，异步从 IndexedDB/Worker 加载目标动作，不回退到卡顿的 <video>
              ensureSpriteEntry(state).then(entry => {
                if (entry && mySeq === videoSwitchSeq) {
                  activateCanvasSprite(actionFolder, entry, resetLoop);
                  if (state === 'idle') prewarmNextClickPose();
                }
              }).catch(() => {});

              if (canvasMode) return;

              // 2. 首次启动尚未烘焙完 idle 前，平滑回退到双缓冲 <video> 过渡
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
                if (mySeq !== videoSwitchSeq || canvasMode) return;

                const nextVideo = (activeVideo === videoA) ? videoB : videoA;
                const prevVideo = activeVideo;
                if (!nextVideo) return;

                let swapped = false;
                const commitSwap = () => {
                  if (swapped || mySeq !== videoSwitchSeq || canvasMode) return;
                  if (nextVideo.videoWidth === 0) return;
                  swapped = true;

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

                nextVideo.style.display = 'block';
                nextVideo.style.opacity = '0.001';
                nextVideo.style.zIndex = '1';
                nextVideo.setAttribute('data-folder', actionFolder);

                nextVideo.onloadeddata = () => {
                  if (mySeq !== videoSwitchSeq || canvasMode) return;
                  const pLoad = nextVideo.play();
                  if (pLoad) pLoad.catch(() => {});
                  if (typeof nextVideo.requestVideoFrameCallback === 'function') {
                    nextVideo.requestVideoFrameCallback(commitSwap);
                    setTimeout(commitSwap, 160);
                  } else {
                    commitSwap();
                  }
                };
                nextVideo.onplaying = commitSwap;

                nextVideo.src = blobUrl;
                const playPromise = nextVideo.play();
                if (playPromise) {
                  playPromise.catch(() => {});
                }
              }).catch(() => {
                if (mySeq === videoSwitchSeq && !activeVideo && !canvasMode && imgEl) {
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
                listEl.innerHTML = '<div class="catgirl-task-empty">当前无运行中任务</div>';
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
                      '<span class="catgirl-task-arrow" title="点击切入对话">›</span>' +
                    '</div>' +
                    (safePrompt ? '<div class="catgirl-task-prompt">' + safePrompt + '</div>' : '') +
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
                      window.__antigravityCatgirl.showBubble('正在切换至《' + taskTitle + '》');
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
                    idle: "已切回待机姿态",
                    thinking: getNextQuote(dialogueBank.thinking),
                    coding: "正在敲键盘处理任务喵",
                    celebrate: "大功告成，快来验收吧",
                    warning: "上下文水位偏高，建议清理"
                  };
                  customDetail = previewQuotes[action] || "已切换姿态";
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

            // 50+ 句精选傲娇 Gemini 猫娘台词库（保留角色个性，移除冗余 Emoji 与叹号堆叠）
            const dialogueBank = {
              idle: [
                "我才不是美版豆包，哼。",
                "才、才不是特意陪你的。",
                "本喵可是 Gemini，记住啦。",
                "“10块钱一年”？本喵才不便宜。",
                "Token 可以省，夸夸不能省。",
                "本喵的聪明，可不按斤卖呢。",
                "怎么，又被本喵可爱到了？",
                "少熬夜，才不是担心你头发呢。",
                "代码写累了？准你摸一下猫耳朵。",
                "看什么看，本喵只是在等你写代码。",
                "哼，这么安静，是在憋什么大招？",
                "星星归天空，本喵归……才不告诉你。",
                "人类，今天也要记得多喝水哦。",
                "十块钱一年？你先说清楚谁在贴钱养谁。",
                "嘴上说随便，Prompt 倒是写了八百字。",
                "你负责许愿，本喵负责把需求问明白。",
                "今天也在认真营业，绝对没有偷偷晒太阳。",
                "上下文那么长，留两行夸夸本喵怎么啦。",
                "别叫我人工智障，叫我偶尔休息的天才。",
                "代码可以重构，猫猫的自尊不能回滚。",
                "又开一个新项目？你上一个真的写完了吗？",
                "听说你在等奇迹，本喵刚好路过。",
                "本喵没摸鱼，只是在进行低功耗深度推理。",
                "你这需求变得，比本喵尾巴还快呢。",
                "先保存文件，再夸本喵，两件都很重要。",
                "报错红了？别慌，本喵的脸可没红。",
                "这不是幻觉，是灵感跑得太快……好吧先核对。",
                "本喵说得再自信，该查文档也得查哦。",
                "禁止拿猫猫的气势代替测试结果。",
                "你说简单改改，本喵耳朵已经立起来了。",
                "需求写清楚一点，本喵才不想猜你心思。",
                "哼，夸别人那么顺，夸本喵就卡壳？",
                "又盯着本喵看？编译器可不会害羞。",
                "本喵这么可爱，居然还得看日志。",
                "别把 TODO 留给明天的猫猫。",
                "今天的 bug 有点多，但今天的本喵依然很强。",
                "你键盘敲得好响，是在给本喵伴奏吗？",
                "凌晨的灵感很贵，明天的黑眼圈更贵哦。",
                "本喵只负责提醒，熬夜的锅可不背。",
                "你不休息，本喵可要替你打哈欠了。",
                "把椅子坐正，别让脖子替代码负重。",
                "想摸耳朵？先把那个文件保存了再说。",
                "今日份夸夸未到账，本喵保留催收权。",
                "别拿叹气当调试工具，贴错误信息啦。",
                "一键生成也要验收，猫猫又不是许愿池。",
                "不是不理你，本喵在组织很厉害的措辞。",
                "别催别催，聪明猫猫也需要加载进度条的。",
                "你说收到，本喵说喵到。",
                "星星有引力，本喵有脾气。",
                "今天的任务：写点代码，再夸点猫猫。",
                "提交之前看一眼 diff，少掉两根头发。",
                "绿色测试很好看，但你也得点开用用看呀。"
              ],
              thinking: [
                "让本喵托腮思考一下，今晚吃什么猫罐头好呢。",
                "别戳啦，本喵正在深度思考宇宙与代码的终极奥秘。",
                "嗯……本喵在想，你今天怎么还没夸我聪明？",
                "托腮沉思中：为什么人类的 Bug 总是比猫毛还多呢？",
                "嘘，天才猫娘正在进入哲学思考模式。",
                "本喵刚才掐爪一算，你至少欠我三顿小鱼干了。"
              ],
              wave: [
                "主人好喵，随时准备好写代码啦。",
                "喵呜，星星猫娘今天也精神饱满哦。",
                "挥挥小爪子，今天想用什么模型？",
                "满血就绪，随时呼叫我哦。"
              ],
              starry: [
                "哇，主人今天写代码的样子真帅气喵。",
                "崇拜眼神锁定，不愧是熟练的代码架构师。",
                "眼睛里全都是小星星，主人太厉害啦。",
                "这么优雅的代码，本喵要偷偷收进收藏夹。"
              ],
              cheerful: [
                "嘻嘻，被摸摸头啦，电量瞬间充到 100%。",
                "心情满分，Bug 都被本喵的笑容融化啦。",
                "喵哈哈，今天的心情是甜甜的猫罐头味。",
                "和主人一起结对编程最开心啦。"
              ],
              shy: [
                "呀……不要一直盯着人家戳嘛。",
                "脸红红……本喵也是会害羞的好不好啦。",
                "咳咳，认真写代码啦，偷看本喵干嘛。",
                "再戳本喵就要躲到屏幕边框后面去啦。"
              ],
              confused: [
                "喵？这里逻辑有点奇妙，让本喵歪头看看。",
                "困惑摸脑勺：这个报错信息是在写火星诗吗？",
                "歪头确认，需要本喵用搜索工具查一查吗？",
                "猫猫挠头：既然没报错，为什么跑不通呢喵？"
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
              if (menu && menu.style.display !== 'none' && typeof positionContextMenu === 'function') {
                positionContextMenu();
              }
              if (typeof positionHudPanel === 'function') {
                positionHudPanel();
              }
              if (bubbleTimer) clearTimeout(bubbleTimer);
              bubbleTimer = setTimeout(() => {
                bubbleWrap.classList.remove('show');
              }, duration);
            }
            window.__catgirl_showBubble = showBubble;

            // 统一的缩放控制中枢（支持滑块拖动、预设档位、滚轮无级缩放与跨会话持久化记忆）
            let currentScale = (typeof window.__catgirl_initial_scale === 'number' && !isNaN(window.__catgirl_initial_scale))
              ? window.__catgirl_initial_scale
              : 1.3;
            try {
              const savedScale = localStorage.getItem('antigravity_catgirl_scale');
              if (savedScale) {
                const parsed = parseFloat(savedScale);
                if (!isNaN(parsed) && parsed >= 0.4 && parsed <= 2.5) {
                  currentScale = parsed;
                }
              }
            } catch(e) {}

            function setScale(scale, fromSource) {
              currentScale = Math.max(0.4, Math.min(2.5, scale));
              dock.style.transform = \`scale(\${currentScale.toFixed(2)})\`;
              dock.style.setProperty('--pet-scale', currentScale.toFixed(2));
              if (typeof lastDrawnFrameIdx === 'number') {
                lastDrawnFrameIdx = -1;
              }
              
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

              // 高亮匹配的预设档位
              document.querySelectorAll('.catgirl-preset-btn').forEach(btn => {
                const s = parseFloat(btn.getAttribute('data-scale'));
                if (Math.abs(s - currentScale) < 0.05) {
                  btn.classList.add('active');
                } else {
                  btn.classList.remove('active');
                }
              });

              try {
                localStorage.setItem('antigravity_catgirl_scale', currentScale.toString());
              } catch(e) {}

              // 防抖同步持久化至磁盘配置文件（通过 sidecar 后台服务），确保重新打开 Antigravity 时保持所设大小
              if (window.__catgirl_scale_sync_timer) {
                clearTimeout(window.__catgirl_scale_sync_timer);
              }
              window.__catgirl_scale_sync_timer = setTimeout(() => {
                const scPort = window.__catgirl_sidecar_port || 18980;
                fetch(\`http://127.0.0.1:\${scPort}/api/config\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ scale: parseFloat(currentScale.toFixed(2)) })
                }).catch(() => {});
              }, 250);

              updateBubblePosition();
              if (menu && menu.style.display !== 'none' && typeof positionContextMenu === 'function') {
                positionContextMenu();
              }
              if (typeof positionHudPanel === 'function') {
                positionHudPanel();
              }

              if (fromSource === 'wheel' || fromSource === 'preset') {
                showBubble(\`大小已调节为 \${percent}%（已保存）\`, 1200);
              }
            }

            // 初始化缩放应用
            setScale(currentScale, 'init');

            // 异步与磁盘配置文件对齐最新缩放大小
            try {
              const scPort = window.__catgirl_sidecar_port || 18980;
              fetch(\`http://127.0.0.1:\${scPort}/api/config\`)
                .then(r => r.json())
                .then(cfg => {
                  if (cfg && typeof cfg.scale === 'number' && !isNaN(cfg.scale)) {
                    if (Math.abs(cfg.scale - currentScale) > 0.01) {
                      setScale(cfg.scale, 'disk_sync');
                    }
                  }
                }).catch(() => {});
            } catch(e) {}

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

            // 4. 待机自动随机彩蛋与点击互动体系（去弹跳化：待机直接切换 60fps 真实角色姿态）
            let interactionEggIndex = 0;
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
              const isNoTaskRunning = currentRunningTasks.length === 0;
              if (isNoTaskRunning) {
                isEasterEggActive = true;
                let picked = IDLE_EASTER_EGGS[interactionEggIndex % IDLE_EASTER_EGGS.length];
                interactionEggIndex = (interactionEggIndex + 1) % IDLE_EASTER_EGGS.length;
                if (picked.act === lastEggAct && IDLE_EASTER_EGGS.length > 1) {
                  picked = IDLE_EASTER_EGGS[interactionEggIndex % IDLE_EASTER_EGGS.length];
                  interactionEggIndex = (interactionEggIndex + 1) % IDLE_EASTER_EGGS.length;
                }
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

              // 任务执行中点击不打断当前工作姿态，仅弹出台词气泡
              const bank = currentAction === 'thinking' ? dialogueBank.thinking : dialogueBank.idle;
              showBubble(getNextQuote(bank));
              scheduleNextIdleEgg();
            }

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
              if (menu && menu.style.display !== 'none') {
                menu.style.display = 'none';
              }
              isPointerDown = true;
              isActualDragging = false;
              if (stageEl) stageEl.classList.add('pet-pressed');
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
                if (stageEl) stageEl.classList.remove('pet-pressed');
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
              if (menu && menu.style.display !== 'none' && typeof positionContextMenu === 'function') {
                positionContextMenu();
              }
              if (typeof positionHudPanel === 'function') {
                positionHudPanel();
              }
              }
            }, { signal });
            window.addEventListener('resize', () => {
              updateBubblePosition();
              if (menu && menu.style.display !== 'none') {
                positionContextMenu();
              }
              if (typeof positionHudPanel === 'function') {
                positionHudPanel();
              }
            }, { signal });

            function onPointerRelease(e) {
              if (!isPointerDown) return;
              isPointerDown = false;
              if (stageEl) stageEl.classList.remove('pet-pressed');

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

            // 智能避让定位：将右键卡片弹出在桌宠侧边，确保绝不遮挡桌宠立绘全图
            function positionContextMenu() {
              if (!menu || menu.style.display === 'none') return;
              const targetEl = document.getElementById('catgirl-body') || dock;
              if (!targetEl) return;
              const targetRect = targetEl.getBoundingClientRect();
              const menuWidth = menu.offsetWidth || 246;
              const menuHeight = menu.offsetHeight || 360;

              let posX = 0;
              let posY = 0;

              const spaceLeft = targetRect.left;
              const spaceRight = window.innerWidth - targetRect.right;

              if (spaceLeft >= menuWidth + 14) {
                // 桌宠在右半屏：弹出至桌宠左侧（留 12px 呼吸间隙，确保绝不遮挡桌宠立绘全图）
                posX = targetRect.left - menuWidth - 12;
              } else if (spaceRight >= menuWidth + 14) {
                // 桌宠在左半屏：弹出至桌宠右侧
                posX = targetRect.right + 12;
              } else {
                // 极小视口极端情况：选择空间较大的一侧避让
                if (spaceLeft >= spaceRight) {
                  posX = Math.max(8, targetRect.left - menuWidth - 8);
                } else {
                  posX = Math.min(window.innerWidth - menuWidth - 8, targetRect.right + 8);
                }
              }

              // 纵向定位：默认底部对齐桌宠底部，并做屏幕上下边界安全保护
              posY = targetRect.bottom - menuHeight;
              if (posY + menuHeight > window.innerHeight - 10) {
                posY = window.innerHeight - menuHeight - 10;
              }
              if (posY < 10) {
                posY = 10;
              }

              menu.style.left = Math.round(posX) + 'px';
              menu.style.top = Math.round(posY) + 'px';
            }

            // HUD 仪表盘四角视口智能避让定位（保证四个角落展开均不被窗口边缘裁切遮挡）
            function positionHudPanel() {
              const hud = document.getElementById('catgirl-dashboard-hud');
              if (!hud || hud.classList.contains('hud-hidden') || hud.style.display === 'none') return;
              const targetEl = document.getElementById('catgirl-body') || dock;
              if (!targetEl) return;
              const targetRect = targetEl.getBoundingClientRect();
              const hudScale = 0.86;
              const visualW = (hud.offsetWidth || 248) * hudScale;
              const visualH = (hud.offsetHeight || 420) * hudScale;

              const spaceLeft = targetRect.left;
              const spaceRight = window.innerWidth - targetRect.right;

              let posX = 10;
              if (spaceLeft >= visualW + 14) {
                posX = targetRect.left - visualW - 12;
              } else if (spaceRight >= visualW + 14) {
                posX = targetRect.right + 12;
              } else if (spaceLeft >= spaceRight) {
                posX = targetRect.left - visualW - 8;
              } else {
                posX = targetRect.right + 8;
              }
              posX = Math.max(10, Math.min(Math.max(10, window.innerWidth - visualW - 10), posX));

              let posY = 10;
              if (targetRect.bottom - visualH >= 10) {
                // 下半屏：与桌宠底部对齐向上展开
                posY = targetRect.bottom - visualH;
              } else {
                // 上半屏：与桌宠顶部对齐向下展开
                posY = targetRect.top;
              }
              posY = Math.max(10, Math.min(Math.max(10, window.innerHeight - visualH - 10), posY));

              hud.style.left = Math.round(posX) + 'px';
              hud.style.top = Math.round(posY) + 'px';
            }

            // 6. 右键菜单呼出（实时刷新正在运行的任务列表，智能侧边避让不遮挡立绘）
            bodyEl.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              e.stopPropagation();

              // 与 HUD 面板保持严格互斥，避免两者在同一侧边位置重叠
              if (typeof toggleDashboardHud === 'function') {
                toggleDashboardHud(false);
              }

              // 立即使用当前最新的任务数据渲染，并启动后台静默更新
              renderRunningTasksMenu(currentRunningTasks);
              syncDashboardData(true);

              menu.style.display = 'block';
              positionContextMenu();
              requestAnimationFrame(positionContextMenu);

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
              showBubble(isAlwaysOnTop ? "已开启置顶" : "已切换为常规层级", 1600);
              menu.style.display = 'none';
            });

            document.getElementById('menu-reset').addEventListener('click', (e) => {
              e.stopPropagation();
              resetToCorner();
              showBubble("已归位至右下角", 1800);
              menu.style.display = 'none';
            });

            document.getElementById('menu-close').addEventListener('click', (e) => {
              e.stopPropagation();
              menu.style.display = 'none';
              showBubble("下次开新会话见啦", 1200);
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

            // 版本检查与一键更新逻辑
            let currentVersion = '1.2.1';
            let latestUpdateInfo = null;

            async function checkPetUpdate(manual = false) {
              const scPort = window.__catgirl_sidecar_port || 18980;
              const icon = document.getElementById('pet-update-icon');
              const btnText = document.getElementById('pet-check-btn-text');
              const detailEl = document.getElementById('pet-update-status-detail');

              if (icon) icon.classList.add('catgirl-spinning');
              if (btnText) btnText.textContent = '检查中...';

              try {
                const endpoint = manual ? \`http://127.0.0.1:\${scPort}/api/check-update\` : \`http://127.0.0.1:\${scPort}/api/update\`;
                const res = await fetch(endpoint, {
                  method: manual ? 'POST' : 'GET',
                  headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                latestUpdateInfo = data;

                if (data.currentVersion) {
                  currentVersion = data.currentVersion;
                  const tag = document.getElementById('pet-version-tag');
                  if (tag) tag.textContent = \`v\${currentVersion}\`;
                }

                if (data.hasUpdate) {
                  if (detailEl) {
                    detailEl.style.display = 'flex';
                    detailEl.innerHTML = \`
                      <div style="color: #4cc38a; font-weight: 500;">发现新版本：v\${data.latestVersion || '最新'}</div>
                      <div style="font-size: 10px; color: #a1a1a6; max-height: 48px; overflow-y: auto;">
                        \${data.commitMessage ? '• ' + data.commitMessage : (data.releaseNotes ? '• ' + data.releaseNotes.substring(0, 60) : '• 优化与体验改进')}
                      </div>
                      <button id="pet-upgrade-btn" class="catgirl-upgrade-action-btn">
                        <span>立即一键配置更新</span>
                      </button>
                    \`;
                    const upBtn = document.getElementById('pet-upgrade-btn');
                    if (upBtn) {
                      upBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        performUpgrade();
                      });
                    }
                  }
                  if (manual) {
                    showBubble(\`发现新版本 v\${data.latestVersion}，可在右键菜单一键更新\`, 2600);
                  } else {
                    showBubble(\`GitHub 有新版本 v\${data.latestVersion}，可在右键菜单更新\`, 3000);
                  }
                } else {
                  if (detailEl && manual) {
                    detailEl.style.display = 'flex';
                    detailEl.innerHTML = \`
                      <div style="color: #38bdf8; font-weight: 500;">当前已是最新版本 (v\${currentVersion})</div>
                      <div style="font-size: 10px; color: #85858b;">无需更新</div>
                    \`;
                  }
                  if (manual) {
                    showBubble(\`当前已是最新版本 (v\${currentVersion})\`, 2000);
                  }
                }
              } catch (err) {
                if (manual && detailEl) {
                  detailEl.style.display = 'flex';
                  detailEl.innerHTML = '<div style="color: #e5484d;">检查失败：网络超时或服务未就绪</div>';
                }
              } finally {
                if (icon) icon.classList.remove('catgirl-spinning');
                if (btnText) btnText.textContent = '检查更新';
                if (typeof positionContextMenu === 'function') positionContextMenu();
              }
            }

            async function performUpgrade() {
              const upBtn = document.getElementById('pet-upgrade-btn');
              const scPort = window.__catgirl_sidecar_port || 18980;
              if (upBtn) {
                upBtn.disabled = true;
                upBtn.innerHTML = '<span>正在拉取更新并配置...</span>';
              }
              showBubble('正在从 GitHub 拉取最新代码与配置...', 4000);

              try {
                const res = await fetch(\`http://127.0.0.1:\${scPort}/api/upgrade\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' }
                });
                const result = await res.json();
                if (result.success) {
                  const newVer = result.version || (latestUpdateInfo ? latestUpdateInfo.latestVersion : '最新版');
                  const tag = document.getElementById('pet-version-tag');
                  if (tag) tag.textContent = \`v\${newVer}\`;
                  const detailEl = document.getElementById('pet-update-status-detail');
                  if (detailEl) {
                    detailEl.innerHTML = \`
                      <div style="color: #4cc38a; font-weight: 500;">一键更新配置完成</div>
                      <div style="font-size: 10px; color: #a1a1a6;">当前版本：v\${newVer}</div>
                    \`;
                    if (typeof positionContextMenu === 'function') positionContextMenu();
                  }
                  if (window.__antigravityCatgirl?.setState) {
                    window.__antigravityCatgirl.setState('celebrate', \`已升级至最新版本 v\${newVer} 喵\`, null, { force: true });
                  }
                } else {
                  if (upBtn) {
                    upBtn.disabled = false;
                    upBtn.innerHTML = '<span>更新失败，点击重试</span>';
                  }
                  showBubble(\`更新失败：\${result.error || '请检查网络'}\`, 2600);
                }
              } catch (err) {
                if (upBtn) {
                  upBtn.disabled = false;
                  upBtn.innerHTML = '<span>请求超时，点击重试</span>';
                }
                showBubble('更新请求超时，请检查网络', 2500);
              }
            }

            const menuUpdateCard = document.getElementById('menu-update-card');
            if (menuUpdateCard) {
              menuUpdateCard.addEventListener('click', (e) => e.stopPropagation());
            }

            const checkUpdateBtn = document.getElementById('pet-check-update-btn');
            if (checkUpdateBtn) {
              checkUpdateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                checkPetUpdate(true);
              });
            }

            // 启动 4.5 秒后在后台静默检查一次更新
            setTimeout(() => {
              checkPetUpdate(false);
            }, 4500);

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
                if (!activeVideo && !canvasMode && imgEl) {
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
                    badgeEl.innerHTML = CG_ICONS.thinking;
                    badgeEl.style.borderColor = 'rgba(237, 237, 237, 0.28)';
                    badgeEl.style.color = '#ededed';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.thinking), 3200);
                    break;
                  case 'coding':
                    badgeEl.innerHTML = CG_ICONS.coding;
                    badgeEl.style.borderColor = 'rgba(56, 189, 248, 0.55)';
                    badgeEl.style.color = '#38bdf8';
                    if (shouldPopBubble) showBubble(detail || "正在敲键盘处理任务喵", 2800);
                    break;
                  case 'celebrate':
                    badgeEl.innerHTML = CG_ICONS.celebrate;
                    badgeEl.style.borderColor = 'rgba(76, 195, 138, 0.6)';
                    badgeEl.style.color = '#4cc38a';
                    if (shouldPopBubble) showBubble(detail || "任务搞定啦，快来验收吧", 4000);
                    break;
                  case 'warning':
                    badgeEl.innerHTML = CG_ICONS.warning;
                    badgeEl.style.borderColor = 'rgba(229, 72, 77, 0.7)';
                    badgeEl.style.color = '#e5484d';
                    setCodingFxActive(false); // 强制关闭敲键盘与飞溅代码
                    let warnDetail = detail;
                    const curPct = (typeof window.__catgirl_current_ctx_pct === 'number' && window.__catgirl_current_ctx_pct > 0) ? window.__catgirl_current_ctx_pct : 80;
                    if (!warnDetail) {
                      warnDetail = "上下文已达 " + curPct + "%，建议执行 /compact";
                    } else if (/上下文已[超达][\\s\\S]*?[0-9]+%/.test(warnDetail)) {
                      // 强制校准气泡文案中的数字与当前胶囊上的真实上下文百分比 100% 保持一致
                      warnDetail = warnDetail.replace(/上下文已[超达][\\s\\S]*?[0-9]+%/, "上下文已达 " + curPct + "%");
                    }
                    if (shouldPopBubble) showBubble(warnDetail, 4200);
                    break;
                  case 'wave':
                    badgeEl.innerHTML = CG_ICONS.wave;
                    badgeEl.style.borderColor = 'rgba(237, 237, 237, 0.25)';
                    badgeEl.style.color = '#ededed';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.wave), 2800);
                    break;
                  case 'starry':
                    badgeEl.innerHTML = CG_ICONS.starry;
                    badgeEl.style.borderColor = 'rgba(56, 189, 248, 0.45)';
                    badgeEl.style.color = '#38bdf8';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.starry), 3000);
                    break;
                  case 'cheerful':
                    badgeEl.innerHTML = CG_ICONS.cheerful;
                    badgeEl.style.borderColor = 'rgba(76, 195, 138, 0.45)';
                    badgeEl.style.color = '#4cc38a';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.cheerful), 2800);
                    break;
                  case 'shy':
                    badgeEl.innerHTML = CG_ICONS.shy;
                    badgeEl.style.borderColor = 'rgba(237, 237, 237, 0.25)';
                    badgeEl.style.color = '#a1a1a6';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.shy), 3000);
                    break;
                  case 'confused':
                    badgeEl.innerHTML = CG_ICONS.confused;
                    badgeEl.style.borderColor = 'rgba(229, 169, 60, 0.5)';
                    badgeEl.style.color = '#e5a93c';
                    if (shouldPopBubble) showBubble(detail || getNextQuote(dialogueBank.confused), 3000);
                    break;
                  case 'fail':
                    badgeEl.innerHTML = CG_ICONS.fail;
                    badgeEl.style.borderColor = 'rgba(229, 72, 77, 0.65)';
                    badgeEl.style.color = '#e5484d';
                    if (shouldPopBubble) showBubble(detail || "任务遇到报错了，快来看看吧", 3500);
                    break;
                  default: // idle
                    badgeEl.innerHTML = CG_ICONS.idle;
                    badgeEl.style.borderColor = 'rgba(237, 237, 237, 0.2)';
                    badgeEl.style.color = '#a1a1a6';
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
            let allHostQuotasCache = { groups: null, lastFetched: 0 };
            if (!window.__catgirl_quota_preview_group) window.__catgirl_quota_preview_group = 'auto';

            // 1. 深度动态感知 Antigravity 输入框/对话当前实时生效的具体模型
            function detectActiveComposerModel() {
              try {
                // 优先从 Antigravity 宿主底部输入框旁的模型选择按钮（带有 aria-label="Select model, current: ..."）提取
                const composerBtn = Array.from(document.querySelectorAll('button')).find(b => {
                  const aria = b.getAttribute('aria-label') || '';
                  const low = aria.toLowerCase();
                  return low.indexOf('select model') !== -1 || aria.indexOf('选择模型') !== -1;
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

                // 备用：深度广谱搜索位于界面下半部（输入框附近）包含模型关键字的按钮
                const allBtns = Array.from(document.querySelectorAll('button')).filter(el => {
                  const r = el.getBoundingClientRect();
                  return el.isConnected && r.width > 0 && r.height > 0 && r.top > (window.innerHeight * 0.4);
                });
                for (const btn of allBtns) {
                  const txt = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
                  if (txt.indexOf('Hydrogen') !== -1 || txt.indexOf('Flash') !== -1 || txt.indexOf('Argon') !== -1 || txt.indexOf('Claude') !== -1 || txt.indexOf('GPT') !== -1 || txt.indexOf('Opus') !== -1 || txt.indexOf('Sonnet') !== -1) {
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
              const raw = (modelName || '').trim();
              const m = raw.toLowerCase();
              if (m.indexOf('argon') !== -1) {
                return {
                  groupId: 'gemini-argon-wtu',
                  groupDisplayName: 'Gemini 4 Argon',
                  badgeName: 'Gemini 4 Argon',
                  isArgon: true,
                  tag: raw || 'Gemini 4 Argon'
                };
              }
              if (m.indexOf('claude') !== -1 || m.indexOf('gpt') !== -1 || m.indexOf('3p') !== -1 || m.indexOf('opus') !== -1 || m.indexOf('sonnet') !== -1) {
                return {
                  groupId: '3p',
                  groupDisplayName: 'Claude and GPT models',
                  badgeName: 'Claude / GPT',
                  isArgon: false,
                  tag: raw || 'Claude / GPT'
                };
              }
              if (m.indexOf('hydrogen') !== -1) {
                return {
                  groupId: 'gemini',
                  groupDisplayName: 'Gemini Models',
                  badgeName: 'Gemini Models',
                  isArgon: false,
                  tag: raw || 'Gemini 4 Hydrogen'
                };
              }
              return {
                groupId: 'gemini',
                groupDisplayName: 'Gemini Models',
                badgeName: 'Gemini Models',
                isArgon: false,
                tag: raw || 'Gemini 3.8 Flash High'
              };
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
              return t.split(',').map(s => s.trim()).join(' ');
            }

            function formatQuotaCountdown(resetTime) {
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

            function classifyGroupId(group) {
              const name = (group?.displayName || group?.id || '').toLowerCase();
              if (name.indexOf('claude') !== -1 || name.indexOf('gpt') !== -1) return '3p';
              if (name.indexOf('argon') !== -1) return 'gemini-argon-wtu';
              return 'gemini';
            }

            // 3. 获取账号下全部模型额度池（Gemini / Claude & GPT / Gemini 4 Argon）
            async function fetchAllHostQuotasFromFiber(force) {
              const now = Date.now();
              if (!force && allHostQuotasCache.groups && (now - allHostQuotasCache.lastFetched < 3000)) {
                return allHostQuotasCache.groups;
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
                  const parsed = allGroups.map(g => {
                    const gId = classifyGroupId(g);
                    const buckets = Array.isArray(g.buckets) ? g.buckets.map(b => {
                      const rawVal = b.remaining?.case === 'remainingFraction' ? b.remaining.value : b.remaining?.value;
                      const pctOne = (typeof rawVal === 'number' && Number.isFinite(rawVal)) ? (Math.round(rawVal * 1000) / 10) : null;
                      const pctDisplay = pctOne !== null ? ((pctOne % 1 === 0 ? pctOne.toFixed(0) : pctOne.toFixed(1)) + '%') : '--';
                      const countStr = parseDescCountdown(b.description) || formatQuotaCountdown(b.resetTime);
                      const is5h = (b.bucketId || '').indexOf('5h') !== -1 || b.window === '5h';
                      const isWeekly = (b.bucketId || '').indexOf('weekly') !== -1 || b.window === 'weekly';
                      return {
                        bucketId: b.bucketId || '',
                        window: is5h ? '5h' : (isWeekly ? 'weekly' : (b.window || '')),
                        displayName: b.displayName || (is5h ? '5h limit' : 'Weekly limit'),
                        pctNum: pctOne,
                        pctDisplay,
                        countdown: countStr
                      };
                    }) : [];
                    return {
                      groupId: gId,
                      displayName: g.displayName || 'Model Pool',
                      description: g.description || '',
                      isArgon: gId === 'gemini-argon-wtu',
                      buckets
                    };
                  });
                  allHostQuotasCache.groups = parsed;
                  allHostQuotasCache.lastFetched = now;
                  return parsed;
                }
              } catch (err) {
                console.error('[星星猫娘] 获取全模型额度异常:', err);
              }
              return allHostQuotasCache.groups || [];
            }

            // 3.1 直接通过 Host React Fiber 提取指定额度组的真实配额与精确倒计时
            async function fetchHostQuotaFromFiber(targetGroupId, force) {
              const chosenGroup = targetGroupId || 'gemini';
              const now = Date.now();
              if (!force && hostQuotaCache.data && (now - hostQuotaCache.lastFetched < 3000) && hostQuotaCache.lastGroup === chosenGroup) {
                return hostQuotaCache.data;
              }
              try {
                const allGroups = await fetchAllHostQuotasFromFiber(force);
                let matchedGroup = allGroups.find(g => g.groupId === chosenGroup);
                if (!matchedGroup && allGroups.length > 0) matchedGroup = allGroups[0];
                if (matchedGroup) {
                  let f5 = null, wk = null, f5Time = '--:--', wkTime = '--:--';
                  for (const b of matchedGroup.buckets) {
                    if (b.window === '5h') {
                      f5 = b.pctDisplay;
                      f5Time = b.countdown;
                    } else if (b.window === 'weekly') {
                      wk = b.pctDisplay;
                      wkTime = b.countdown;
                    }
                  }
                  const resData = {
                    fiveHour: f5,
                    weekly: wk,
                    fiveTime: f5Time,
                    weekTime: wkTime,
                    groupDisplayName: matchedGroup.displayName
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

            // 3.9 获取当前活跃对话框 ID（从宿主路由 /c/<conversationId> 实时解析）
            function getActiveConversationId() {
              try {
                const m = (window.location.pathname || '').match(new RegExp('/c/([0-9a-zA-Z_-]{8,64})'));
                if (m && m[1]) return m[1];
              } catch (e) {}
              return 'none';
            }

            // 4. 实时监听输入框、模型切换与对话框路由切换
            function setupRealtimeModelObserver() {
              try {
                if (window.__catgirl_model_observer) return;
                let observerTimer = null;
                const obs = new MutationObserver(() => {
                  if (observerTimer) return;
                  observerTimer = setTimeout(() => {
                    observerTimer = null;
                    const curConv = getActiveConversationId();
                    const curModel = detectActiveComposerModel();
                    if (curConv !== window.__catgirl_last_conv_id || (curModel && curModel !== window.__catgirl_last_active_model)) {
                      syncDashboardData(true);
                    }
                  }, 120);
                });
                obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'data-testid'] });
                window.addEventListener('popstate', () => syncDashboardData(true), { signal });
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
              let quotaText = '5h --';
              if (!isNaN(fiveNum)) {
                quotaText = '5h ' + Math.round(fiveNum) + '%';
              } else if (data.fiveBalance && data.fiveBalance !== '--') {
                quotaText = data.fiveBalance;
              } else if (data.weekBalance && data.weekBalance !== '--') {
                quotaText = '周 ' + data.weekBalance;
              }

              let shortModel = activeModel ? activeModel.replace(/^Gemini[ ]+/i, '').replace(/[ ]+High$/i, '').trim() : 'Gemini';

              const pillPctEl = document.getElementById('live-pill-ctx-pct');
              if (pillPctEl) {
                pillPctEl.textContent = ctxPct + '%';
                if (ctxPct >= 80) pillPctEl.style.color = '#dc2626';
                else if (ctxPct >= 60) pillPctEl.style.color = '#d97706';
                else pillPctEl.style.color = '#171717';
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
                  pillBarEl.style.background = '#dc2626';
                } else if (ctxPct >= 60) {
                  pillBarEl.style.background = '#d97706';
                } else {
                  pillBarEl.style.background = '#171717';
                }
              }

              const pillQuotaBadge = document.getElementById('live-pill-quota-badge');
              if (pillQuotaBadge) {
                pillQuotaBadge.textContent = quotaText;
                if (!isNaN(fiveNum) && fiveNum <= 10) {
                  pillQuotaBadge.style.background = '#fef2f2';
                  pillQuotaBadge.style.color = '#dc2626';
                  pillQuotaBadge.style.borderColor = '#fecaca';
                } else if (!isNaN(fiveNum) && fiveNum <= 30) {
                  pillQuotaBadge.style.background = '#fffbeb';
                  pillQuotaBadge.style.color = '#d97706';
                  pillQuotaBadge.style.borderColor = '#fde68a';
                } else {
                  pillQuotaBadge.style.background = '#f4f4f5';
                  pillQuotaBadge.style.color = '#171717';
                  pillQuotaBadge.style.borderColor = 'rgba(23, 23, 23, 0.1)';
                }
              }

              const pillModelBadge = document.getElementById('live-pill-model-badge');
              if (pillModelBadge) {
                pillModelBadge.textContent = shortModel;
                pillModelBadge.title = activeModel;
              }

              if (tokenDotEl) {
                if (ctxPct >= 80 || (!isNaN(fiveNum) && fiveNum <= 10)) {
                  tokenDotEl.style.background = '#dc2626';
                } else if (ctxPct >= 60 || (!isNaN(fiveNum) && fiveNum <= 30)) {
                  tokenDotEl.style.background = '#d97706';
                } else {
                  tokenDotEl.style.background = '#16a34a';
                }
              }

              if (tokenTextEl) {
                tokenTextEl.textContent = 'Ctx: ' + tokenDisplay + ' (' + ctxPct + '%)';
              }

              const pillEl = document.getElementById('live-catgirl-token-pill');
              if (pillEl) {
                pillEl.title = "当前实时模型: " + activeModel + " | 上下文: " + (data.contextTokens || (tokenDisplay + " tok")) + " (" + ctxPct + "% 已用) | 本对话累计: " + (data.convTotal || '--') + " | [" + quotaGroup + "] 5小时: " + data.fiveBalance + " · 周: " + data.weekBalance + " (点击展开完整看板)";
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
              const hudConvTotalVal = document.getElementById('live-hud-conv-total-val');
              const hudConvReq = document.getElementById('live-hud-conv-req');
              const hudModelTag = document.getElementById('live-hud-model-tag');
              const hudQuotaGroupName = document.getElementById('live-hud-quota-group-name');
              const hudQuotaStatus = document.getElementById('live-hud-quota-status');
              const hudBottomBtn = document.getElementById('live-hud-open-full-dashboard');

              if (hudQuotaGroupName) hudQuotaGroupName.textContent = quotaGroup;

              if (hudFiveVal) hudFiveVal.textContent = data.fiveBalance;
              if (hudFiveBar) {
                if (data.fiveBalance === '随周额度' || data.fiveBalance === '不限') {
                  hudFiveBar.style.width = '100%';
                  hudFiveBar.style.background = '#38bdf8';
                } else {
                  hudFiveBar.style.width = data.fiveBalance.includes('%') ? data.fiveBalance : '100%';
                  if (!isNaN(fiveNum)) {
                    if (fiveNum <= 10) hudFiveBar.style.background = '#e5484d';
                    else if (fiveNum <= 30) hudFiveBar.style.background = '#e5a93c';
                    else hudFiveBar.style.background = '#4cc38a';
                  }
                }
              }
              if (hudFiveTime) hudFiveTime.textContent = data.fiveCountdown;

              if (hudWeekVal) hudWeekVal.textContent = data.weekBalance;
              if (hudWeekBar) {
                hudWeekBar.style.width = data.weekBalance.includes('%') ? data.weekBalance : '100%';
                const weekNum = parseFloat(data.weekBalance);
                if (!isNaN(weekNum)) {
                  if (weekNum <= 10) hudWeekBar.style.background = '#e5484d';
                  else if (weekNum <= 30) hudWeekBar.style.background = '#e5a93c';
                  else hudWeekBar.style.background = '#38bdf8';
                }
              }
              if (hudWeekTime) hudWeekTime.textContent = data.weekCountdown;

              if (hudCtxBadge) hudCtxBadge.textContent = ctxPct + '% 已用';
              if (hudCtxBar) {
                hudCtxBar.style.width = ctxPct + '%';
                if (ctxPct >= 80) hudCtxBar.style.background = '#e5484d';
                else if (ctxPct >= 60) hudCtxBar.style.background = '#e5a93c';
                else hudCtxBar.style.background = '#38bdf8';
              }
              if (hudCtxTokens) hudCtxTokens.textContent = data.contextTokens || (tokenDisplay + ' / 256K tok');

              if (hudCtxHint) {
                if (ctxPct >= 80) {
                  hudCtxHint.textContent = '上下文达到 80%，建议执行 /compact';
                  hudCtxHint.style.color = '#e5484d';
                } else if (ctxPct >= 60) {
                  hudCtxHint.textContent = '建议适时执行 /compact';
                  hudCtxHint.style.color = '#e5a93c';
                } else {
                  hudCtxHint.textContent = '上下文正常';
                  hudCtxHint.style.color = '#4cc38a';
                }
              }

              if (hudQuotaStatus) {
                if (!isNaN(fiveNum) && fiveNum <= 15) {
                  hudQuotaStatus.textContent = '额度紧张';
                  hudQuotaStatus.style.color = '#e5484d';
                } else if (!isNaN(fiveNum) && fiveNum <= 30) {
                  hudQuotaStatus.textContent = '额度偏低';
                  hudQuotaStatus.style.color = '#e5a93c';
                } else {
                  hudQuotaStatus.textContent = '正常';
                  hudQuotaStatus.style.color = '#4cc38a';
                }
              }

              if (hudTodayVal) hudTodayVal.textContent = data.today;
              if (hudMonthVal) hudMonthVal.textContent = data.month;
              if (hudTpsVal) hudTpsVal.textContent = data.tps;
              if (hudCacheVal) hudCacheVal.textContent = data.cacheRate;
              if (hudConvTotalVal) hudConvTotalVal.textContent = data.convTotal || '--';
              if (hudConvReq) hudConvReq.textContent = (data.convRequests > 0) ? '(' + data.convRequests + ' 次请求)' : '';
              if (hudModelTag) hudModelTag.textContent = data.contextModel;

              const hudFooter = document.getElementById('live-hud-footer');
              if (hudFooter) {
                hudFooter.style.display = (data.mode === 'pulse') ? 'flex' : 'none';
              }
              if (hudBottomBtn && data.mode === 'pulse') {
                hudBottomBtn.textContent = '打开外部 Dashboard';
                hudBottomBtn.title = '已检测到外部 Antigravity Dashboard 插件，点击呼出分析面板';
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
                targetDetail = stats.autoDetail || "任务完成，可以验收啦";
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
                targetDetail = "上下文已达 " + effectiveCtxPct + "%，建议执行 /compact";
              } else if (runningCount > 0 || stats.hasRunningTask) {
                targetState = 'coding';
                targetDetail = stats.autoDetail || "正在处理当前任务";
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

            // 7. 核心数据同步（根据当前对话正在实时使用的模型进行智能配额切换，并支持预览任意模型额度池）
            async function syncDashboardData(force = false) {
              try {
                setupRealtimeModelObserver();
                const bar = document.getElementById('ag-pulse-status-bar');
                const shadow = bar?.shadowRoot;
                const sidecarPort = window.__catgirl_sidecar_port || 51149;

                // 1. 先拉取本地 sidecar 统计（按当前活跃对话框 conversation_id 精准拉取，并可拿到后端精准模型名）
                let stats = null;
                const activeConvId = getActiveConversationId();
                const isConvChanged = (window.__catgirl_last_conv_id && window.__catgirl_last_conv_id !== activeConvId);
                window.__catgirl_last_conv_id = activeConvId;
                if (isConvChanged) {
                  window.__catgirl_current_ctx_pct = 0;
                }

                let liveHostPct = null;
                if (shadow) {
                  const rawShadowPct = (shadow.getElementById('context-percent')?.textContent || '').trim();
                  if (rawShadowPct && rawShadowPct !== '—') {
                    const p = parseInt(rawShadowPct, 10);
                    if (!isNaN(p) && p >= 0 && p <= 100) liveHostPct = p;
                  } else {
                    const sumMatch = (shadow.getElementById('context-summary')?.textContent || '').match(/([0-9]+)%/);
                    if (sumMatch) liveHostPct = parseInt(sumMatch[1], 10);
                  }
                }

                try {
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 2500);
                  const qs = new URLSearchParams();
                  if (activeConvId) qs.set('conversation_id', activeConvId);
                  if (liveHostPct !== null && liveHostPct > 0) qs.set('host_ctx_pct', String(liveHostPct));
                  const queryStr = qs.toString() ? ('?' + qs.toString()) : '';
                  const resp = await fetch('http://127.0.0.1:' + sidecarPort + '/api/stats' + queryStr, {
                    signal: controller.signal,
                    cache: 'no-store'
                  });
                  clearTimeout(timer);
                  if (resp.ok) stats = await resp.json();
                } catch (e) {}

                // 2. 动态感知当前对话正在实时生效的具体模型（结合前端控件与后端对话日志）
                let detectedModel = detectActiveComposerModel();
                const backendModel = (stats && stats.model && stats.model !== 'Gemini') ? stats.model : '';
                if (!detectedModel || /^(high|medium|low|minimal|thinking)$/i.test(detectedModel)) {
                  detectedModel = backendModel || detectedModel || 'Gemini 3.8 Flash High';
                }
                const activeModel = detectedModel;

                // 3. 将当前模型精准映射至官方额度组 (Gemini Models / 4 Argon / Claude & GPT)
                const quotaMeta = resolveQuotaGroupFromModel(activeModel);
                const previewPool = window.__catgirl_quota_preview_group || 'auto';
                const targetQuotaGroupId = (previewPool !== 'auto') ? previewPool : quotaMeta.groupId;

                if (window.__catgirl_last_active_model && window.__catgirl_last_active_model !== activeModel) {
                  if (window.__antigravityCatgirl?.showBubble && !isEasterEggActive) {
                    window.__antigravityCatgirl.showBubble('已切换至 ' + activeModel + '，配额池已同步', 2400);
                  }
                  force = true;
                }
                window.__catgirl_last_active_model = activeModel;

                // 同步 HUD 额度池切换标签高亮
                const switcherEl = document.getElementById('live-hud-quota-switcher');
                if (switcherEl) {
                  switcherEl.querySelectorAll('.hud-quota-tab[data-pool]').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-pool') === previewPool);
                  });
                }

                // 4. 从 React Fiber 原生直连获取目标额度组对应的最权威 5h & 周配额与重置时间
                let realFive = '--';
                let realWeek = '--';
                let fiveCount = '--:--';
                let weekCount = '--:--';
                let displayGroupName = quotaMeta.badgeName;

                try {
                  const fiberQuota = await fetchHostQuotaFromFiber(targetQuotaGroupId, force);
                  if (fiberQuota) {
                    displayGroupName = fiberQuota.groupDisplayName || displayGroupName;
                    if (targetQuotaGroupId === 'gemini-argon-wtu' && !fiberQuota.fiveHour) {
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

                // 5. 读取上下文与历史汇总指标
                let today = stats?.today || '0';
                let month = stats?.month || '0';
                let tps = stats?.tps ? (String(stats.tps).includes('tok/s') ? stats.tps : stats.tps + ' tok/s') : '--';
                let cacheRate = stats?.cacheRate || '--';
                let convTotal = stats?.convTotal || '0 tok';
                let convRequests = Number(stats?.convRequests || 0);
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
                  quotaGroupName: displayGroupName,
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
                  convTotal,
                  convRequests,
                  contextTokens: ctxTokens
                });

                if (stats) applyAutoPoseFromStats(stats, ctxPct);
              } catch (e) {
                console.error('[星星猫娘] 同步异常:', e);
              }
            }
            window.__catgirl_sync_dashboard = syncDashboardData;

            // 7.5 完整用量统计与全模型额度中心弹窗 (活动概览热力图 + 按模型统计详情 + 全部模型额度)
            async function openCatgirlAnalyticsModal(initialTab = 'activity') {
              const existing = document.getElementById('catgirl-analytics-modal');
              if (existing) existing.remove();

              const MODEL_COLORS = ['#38bdf8', '#64748b', '#4cc38a', '#94a3b8', '#e5a93c', '#7dd3fc', '#cbd5e1'];
              const state = {
                tab: initialTab || 'activity',
                lang: 'zh',
                granularity: 'day', // 'day' | 'week' | 'month'
                heatMode: 'daily',  // 'daily' | 'weekly'
                year: new Date().getFullYear(),
                monthKey: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
                selectedDate: '',
                hiddenModels: {},
                analytics: null,
                quotas: []
              };

              const modal = document.createElement('div');
              modal.id = 'catgirl-analytics-modal';
              modal.innerHTML = '<div class="cg-modal-card">' +
                '<div class="cg-modal-head">' +
                  '<div>' +
                    '<div class="cg-modal-title" id="cg-m-title">用量统计与模型额度</div>' +
                    '<div class="cg-modal-sub"><span class="cg-dot-green"></span><span id="cg-m-sub">本机 Antigravity · 当前账号</span></div>' +
                  '</div>' +
                  '<div class="cg-head-actions">' +
                    '<button class="cg-icon-btn" id="cg-lang-btn" title="切换中英文">EN</button>' +
                    '<button class="cg-icon-btn" id="cg-refresh-btn" title="刷新统计与额度">↻</button>' +
                    '<button class="cg-icon-btn" id="cg-close-btn" title="关闭">✕</button>' +
                  '</div>' +
                '</div>' +
                '<div class="cg-tabs">' +
                  '<button class="cg-tab-btn" data-tab="activity" id="cg-tab-activity">活动概览</button>' +
                  '<button class="cg-tab-btn" data-tab="details" id="cg-tab-details">用量详情</button>' +
                  '<button class="cg-tab-btn" data-tab="quotas" id="cg-tab-quotas">全部模型额度</button>' +
                '</div>' +
                '<div class="cg-modal-body" id="cg-modal-body"><div style="padding:36px;text-align:center;color:#94a3b8;">正在读取本地对话统计与实时额度...</div></div>' +
                '<div class="cg-tooltip" id="cg-tooltip"></div>' +
              '</div>';

              document.body.appendChild(modal);

              const tooltipEl = modal.querySelector('#cg-tooltip');
              const bodyElModal = modal.querySelector('#cg-modal-body');

              function closeModal() {
                modal.remove();
              }

              modal.addEventListener('pointerdown', (e) => {
                if (e.target === modal) closeModal();
              });
              modal.querySelector('#cg-close-btn').addEventListener('click', closeModal);
              const onEsc = (e) => {
                if (e.key === 'Escape') {
                  closeModal();
                  document.removeEventListener('keydown', onEsc);
                }
              };
              document.addEventListener('keydown', onEsc);

              function fmtTokShort(n) {
                const v = Number(n || 0);
                if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                if (v >= 1000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'K';
                return String(v);
              }
              function fmtNum(n) {
                return Number(n || 0).toLocaleString();
              }
              function getModelColor(modelName, allModels) {
                const idx = allModels.indexOf(modelName);
                return MODEL_COLORS[(idx >= 0 ? idx : 0) % MODEL_COLORS.length];
              }
              function t(zh, en) {
                return state.lang === 'en' ? en : zh;
              }
              function showTip(ev, html) {
                tooltipEl.innerHTML = html;
                tooltipEl.style.display = 'block';
                const x = Math.min(window.innerWidth - 230, ev.clientX + 12);
                const y = Math.min(window.innerHeight - 130, ev.clientY + 12);
                tooltipEl.style.left = x + 'px';
                tooltipEl.style.top = y + 'px';
              }
              function hideTip() {
                tooltipEl.style.display = 'none';
              }

              async function loadAllData(force) {
                const sidecarPort = window.__catgirl_sidecar_port || 51149;
                try {
                  const [aResp, qGroups] = await Promise.all([
                    fetch('http://127.0.0.1:' + sidecarPort + '/api/analytics' + (force ? '?refresh=1' : ''), { cache: 'no-store' })
                      .then(r => r.ok ? r.json() : null).catch(() => null),
                    fetchAllHostQuotasFromFiber(force).catch(() => [])
                  ]);
                  if (aResp) {
                    state.analytics = aResp;
                    if (!state.selectedDate) {
                      const days = Object.keys(aResp.daily || {}).sort();
                      state.selectedDate = aResp.daily?.[aResp.todayStr] ? aResp.todayStr : (days[days.length - 1] || aResp.todayStr || '');
                    }
                    if (aResp.todayStr) state.monthKey = aResp.todayStr.slice(0, 7);
                  }
                  state.quotas = Array.isArray(qGroups) ? qGroups : [];
                } catch (e) {}
                renderModal();
              }

              function buildSummaryHtml(summary) {
                const s = summary || { today: 0, week: 0, month: 0, allTime: 0 };
                const unit = t('Token', 'Token');
                const items = [
                  { label: t('今日用量', 'Today'), val: fmtTokShort(s.today) },
                  { label: t('本周用量', 'This week'), val: fmtTokShort(s.week) },
                  { label: t('本月用量', 'This month'), val: fmtTokShort(s.month) },
                  { label: t('累计用量', 'All time'), val: fmtTokShort(s.allTime) }
                ];
                return '<div class="cg-summary-grid">' + items.map(it =>
                  '<div class="cg-summary-cell">' +
                    '<div class="cg-summary-label">' + it.label + '</div>' +
                    '<div class="cg-summary-val">' + it.val + '<span class="cg-summary-unit">' + unit + '</span></div>' +
                  '</div>'
                ).join('') + '</div>';
              }

              function renderActivityTab() {
                const data = state.analytics || { summary: {}, daily: {}, years: [state.year] };
                const daily = data.daily || {};
                const yr = state.year;
                const years = (data.years && data.years.length) ? data.years : [yr];

                // 计算全年每日格子（从该年1月1日所在周的周一开始，到12月31日）
                const jan1 = new Date(yr, 0, 1);
                const startOffset = (jan1.getDay() + 6) % 7; // Monday=0
                const gridStart = new Date(yr, 0, 1 - startOffset);
                const dec31 = new Date(yr, 11, 31);
                const cells = [];
                let yearTokens = 0;
                let maxDayTok = 1;
                for (let d = new Date(gridStart); d <= dec31 || d.getDay() !== 1; d.setDate(d.getDate() + 1)) {
                  const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                  const inYear = d.getFullYear() === yr;
                  const entry = inYear ? daily[key] : null;
                  const tot = entry ? entry.total : 0;
                  if (inYear) {
                    yearTokens += tot;
                    if (tot > maxDayTok) maxDayTok = tot;
                  }
                  cells.push({
                    dateKey: key,
                    inYear,
                    total: tot,
                    requests: entry ? entry.requests : 0,
                    month: d.getMonth(),
                    day: d.getDate()
                  });
                }

                const weeksCount = Math.ceil(cells.length / 7);
                const monthNames = state.lang === 'en'
                  ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  : ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

                // 计算每月起始列位置
                const monthColMap = {};
                for (let w = 0; w < weeksCount; w++) {
                  for (let r = 0; r < 7; r++) {
                    const c = cells[w * 7 + r];
                    if (c && c.inYear && c.day <= 7 && monthColMap[c.month] === undefined) {
                      monthColMap[c.month] = w;
                    }
                  }
                }

                let heatGridHtml = '';
                if (state.heatMode === 'daily') {
                  const monthsHeader = monthNames.map((mn, idx) => {
                    const col = monthColMap[idx] ?? idx * 4;
                    return '<span style="grid-column:' + (col + 1) + '">' + mn + '</span>';
                  }).join('');

                  const dayLabels = state.lang === 'en'
                    ? ['M', '', 'W', '', 'F', '', 'S']
                    : ['一', '', '三', '', '五', '', '日'];

                  const tilesHtml = cells.map(c => {
                    if (!c.inYear) return '<div class="cg-heat-cell" style="opacity:0;pointer-events:none"></div>';
                    let lvl = '';
                    if (c.total > 0) {
                      const ratio = c.total / maxDayTok;
                      if (ratio > 0.65) lvl = 'cg-heat-l4';
                      else if (ratio > 0.35) lvl = 'cg-heat-l3';
                      else if (ratio > 0.12) lvl = 'cg-heat-l2';
                      else lvl = 'cg-heat-l1';
                    }
                    const sel = (state.selectedDate === c.dateKey) ? ' selected' : '';
                    return '<div class="cg-heat-cell ' + lvl + sel + '" data-date="' + c.dateKey + '" data-tot="' + c.total + '" data-req="' + c.requests + '"></div>';
                  }).join('');

                  heatGridHtml =
                    '<div class="cg-heatmap-scroll">' +
                      '<div class="cg-heatmap-months" style="grid-template-columns:repeat(' + weeksCount + ',14px);">' + monthsHeader + '</div>' +
                      '<div class="cg-heatmap-main">' +
                        '<div class="cg-heatmap-days">' + dayLabels.map(l => '<span>' + l + '</span>').join('') + '</div>' +
                        '<div class="cg-heatmap-grid">' + tilesHtml + '</div>' +
                      '</div>' +
                    '</div>';
                } else {
                  // 按周聚合热力格
                  const weekBuckets = [];
                  let maxWkTok = 1;
                  for (let w = 0; w < weeksCount; w++) {
                    let wTot = 0, wReq = 0, firstKey = '';
                    for (let r = 0; r < 7; r++) {
                      const c = cells[w * 7 + r];
                      if (c && c.inYear) {
                        if (!firstKey) firstKey = c.dateKey;
                        wTot += c.total;
                        wReq += c.requests;
                      }
                    }
                    if (wTot > maxWkTok) maxWkTok = wTot;
                    weekBuckets.push({ idx: w + 1, firstKey, total: wTot, requests: wReq });
                  }
                  heatGridHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(32px,1fr));gap:6px;padding:6px 0;">' +
                    weekBuckets.map(wb => {
                      let lvl = '';
                      if (wb.total > 0) {
                        const ratio = wb.total / maxWkTok;
                        if (ratio > 0.65) lvl = 'cg-heat-l4';
                        else if (ratio > 0.35) lvl = 'cg-heat-l3';
                        else if (ratio > 0.12) lvl = 'cg-heat-l2';
                        else lvl = 'cg-heat-l1';
                      }
                      return '<div class="cg-heat-cell ' + lvl + '" data-date="' + (wb.firstKey || '') + '" data-tot="' + wb.total + '" data-req="' + wb.requests + '" style="width:100%;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9.5px;color:#cbd5e1;">W' + wb.idx + '</div>';
                    }).join('') +
                  '</div>';
                }

                const selEntry = daily[state.selectedDate] || { total: 0, requests: 0 };
                const selBanner =
                  '<div class="cg-selected-banner">' +
                    '<div>' +
                      '<div style="font-size:13px;font-weight:700;color:#f8fafc;">' + (state.selectedDate || data.todayStr || '--') + '</div>' +
                      '<div style="font-size:11.5px;color:#94a3b8;margin-top:2px;">' + fmtNum(selEntry.total) + ' Token · ' + selEntry.requests + ' ' + t('次请求', 'requests') + '</div>' +
                    '</div>' +
                    '<button class="cg-link-btn" id="cg-jump-details-btn">' + t('查看用量详情 →', 'View usage →') + '</button>' +
                  '</div>';

                return buildSummaryHtml(data.summary) +
                  '<div class="cg-panel">' +
                    '<div class="cg-panel-head">' +
                      '<div>' +
                        '<div class="cg-panel-title">' + t('Token 活动热力图', 'Token activity') + '</div>' +
                        '<div class="cg-panel-sub">' + t('每个方块代表一天', 'Each square is one day') + '</div>' +
                      '</div>' +
                      '<div style="display:flex;align-items:center;gap:8px;">' +
                        '<div class="cg-seg-group">' +
                          '<button class="cg-seg-btn' + (state.heatMode === 'daily' ? ' active' : '') + '" data-heat="daily">' + t('日', 'Daily') + '</button>' +
                          '<button class="cg-seg-btn' + (state.heatMode === 'weekly' ? ' active' : '') + '" data-heat="weekly">' + t('周', 'Weekly') + '</button>' +
                        '</div>' +
                        '<select class="cg-select" id="cg-year-sel">' + years.map(y => '<option value="' + y + '"' + (y === yr ? ' selected' : '') + '>' + y + '</option>').join('') + '</select>' +
                      '</div>' +
                    '</div>' +
                    heatGridHtml +
                    '<div class="cg-heatmap-foot">' +
                      '<span>' + yr + ' · ' + fmtNum(yearTokens) + ' tokens</span>' +
                      '<div style="display:flex;align-items:center;gap:4px;">' +
                        '<span>' + t('低', 'Less') + '</span>' +
                        '<span class="cg-heat-cell" style="cursor:default"></span>' +
                        '<span class="cg-heat-cell cg-heat-l1" style="cursor:default"></span>' +
                        '<span class="cg-heat-cell cg-heat-l2" style="cursor:default"></span>' +
                        '<span class="cg-heat-cell cg-heat-l3" style="cursor:default"></span>' +
                        '<span class="cg-heat-cell cg-heat-l4" style="cursor:default"></span>' +
                        '<span>' + t('高', 'More') + '</span>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  selBanner;
              }

              function renderDetailsTab() {
                const data = state.analytics || { summary: {}, daily: {}, models: [] };
                const daily = data.daily || {};
                const allModels = data.models || [];
                const activeModels = allModels.filter(m => !state.hiddenModels[m]);

                const mk = state.monthKey;
                const yr = parseInt(mk.slice(0, 4), 10);
                const mo = parseInt(mk.slice(5, 7), 10);

                // 构造柱状图桶 buckets: [{ label, tick, total, requests, byModel }]
                const buckets = [];
                if (state.granularity === 'day') {
                  const daysInMonth = new Date(yr, mo, 0).getDate();
                  for (let d = 1; d <= daysInMonth; d++) {
                    const key = mk + '-' + String(d).padStart(2, '0');
                    const row = daily[key];
                    const showTick = (d === 1 || d % 3 === 1 || d === daysInMonth);
                    buckets.push({
                      label: key,
                      tick: showTick ? String(d) : '',
                      requests: row ? row.requests : 0,
                      byModel: row ? row.byModel : {}
                    });
                  }
                } else if (state.granularity === 'week') {
                  const daysInMonth = new Date(yr, mo, 0).getDate();
                  for (let w = 0; w < 5; w++) {
                    const dStart = w * 7 + 1;
                    if (dStart > daysInMonth) break;
                    const dEnd = Math.min(daysInMonth, dStart + 6);
                    const agg = {};
                    let req = 0;
                    for (let d = dStart; d <= dEnd; d++) {
                      const key = mk + '-' + String(d).padStart(2, '0');
                      const row = daily[key];
                      if (row) {
                        req += row.requests;
                        Object.entries(row.byModel || {}).forEach(([m, v]) => {
                          if (!agg[m]) agg[m] = { total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 };
                          agg[m].total += v.total;
                          agg[m].input += v.input;
                          agg[m].cacheRead += v.cacheRead;
                          agg[m].cacheWrite += v.cacheWrite;
                          agg[m].output += v.output;
                          agg[m].requests += v.requests;
                        });
                      }
                    }
                    buckets.push({ label: mk + ' (' + dStart + '-' + dEnd + ')', tick: 'W' + (w + 1), requests: req, byModel: agg });
                  }
                } else {
                  for (let m = 1; m <= 12; m++) {
                    const prefix = yr + '-' + String(m).padStart(2, '0');
                    const agg = {};
                    let req = 0;
                    Object.keys(daily).forEach(k => {
                      if (k.startsWith(prefix)) {
                        const row = daily[k];
                        req += row.requests;
                        Object.entries(row.byModel || {}).forEach(([mod, v]) => {
                          if (!agg[mod]) agg[mod] = { total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 };
                          agg[mod].total += v.total;
                          agg[mod].input += v.input;
                          agg[mod].cacheRead += v.cacheRead;
                          agg[mod].cacheWrite += v.cacheWrite;
                          agg[mod].output += v.output;
                          agg[mod].requests += v.requests;
                        });
                      }
                    });
                    buckets.push({ label: prefix, tick: m + (state.lang === 'en' ? 'M' : '月'), requests: req, byModel: agg });
                  }
                }

                // 计算周期总计、最大柱高度与模型明细表汇总
                let periodTotal = 0;
                let periodReqs = 0;
                let maxBar = 1;
                const tableAgg = {};

                buckets.forEach(b => {
                  let barSum = 0;
                  periodReqs += b.requests;
                  Object.entries(b.byModel || {}).forEach(([mod, v]) => {
                    if (state.hiddenModels[mod]) return;
                    barSum += v.total;
                    periodTotal += v.total;
                    if (!tableAgg[mod]) tableAgg[mod] = { total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
                    tableAgg[mod].total += v.total;
                    tableAgg[mod].input += v.input;
                    tableAgg[mod].cacheRead += v.cacheRead;
                    tableAgg[mod].cacheWrite += v.cacheWrite;
                    tableAgg[mod].output += v.output;
                  });
                  b._visibleTotal = barSum;
                  if (barSum > maxBar) maxBar = barSum;
                });

                const yNiceMax = maxBar <= 1000 ? 1000 : Math.ceil(maxBar / Math.pow(10, Math.floor(Math.log10(maxBar)) - 1)) * Math.pow(10, Math.floor(Math.log10(maxBar)) - 1);

                const legendHtml = allModels.map(m => {
                  const muted = state.hiddenModels[m] ? ' muted' : '';
                  const col = getModelColor(m, allModels);
                  return '<div class="cg-legend-item' + muted + '" data-model="' + m + '"><span class="cg-legend-dot" style="background:' + col + '"></span><span>' + m + '</span></div>';
                }).join('');

                const yTicks = [0, 0.25, 0.5, 0.75, 1].map(frac => {
                  const pctBottom = frac * 100;
                  const valLabel = frac === 0 ? '0' : fmtTokShort(Math.round(yNiceMax * frac));
                  return '<div class="cg-y-grid" style="bottom:' + pctBottom + '%"><span class="cg-y-label">' + valLabel + '</span></div>';
                }).join('');

                const barsHtml = buckets.map((b, idx) => {
                  const hPct = b._visibleTotal > 0 ? Math.max(2, (b._visibleTotal / yNiceMax) * 100) : 0;
                  const segs = activeModels.map(m => {
                    const v = b.byModel?.[m]?.total || 0;
                    if (!v || !b._visibleTotal) return '';
                    const segPct = (v / b._visibleTotal) * 100;
                    const col = getModelColor(m, allModels);
                    return '<div style="height:' + segPct.toFixed(2) + '%;background:' + col + ';"></div>';
                  }).join('');
                  return '<div class="cg-bar-col" data-bidx="' + idx + '">' +
                    '<div class="cg-bar-stack" style="height:' + hPct.toFixed(2) + '%;">' + segs + '</div>' +
                  '</div>';
                }).join('');

                const xAxisHtml = buckets.map(b => '<div class="cg-x-tick">' + b.tick + '</div>').join('');

                const tableRows = Object.keys(tableAgg).sort((a, b) => tableAgg[b].total - tableAgg[a].total).map(m => {
                  const row = tableAgg[m];
                  const col = getModelColor(m, allModels);
                  return '<tr>' +
                    '<td><span class="cg-legend-dot" style="background:' + col + ';margin-right:8px;"></span>' + m + '</td>' +
                    '<td>' + fmtNum(row.total) + '</td>' +
                    '<td>' + fmtNum(row.input) + '</td>' +
                    '<td>' + fmtNum(row.cacheRead) + '</td>' +
                    '<td>' + fmtNum(row.cacheWrite) + '</td>' +
                    '<td>' + fmtNum(row.output) + '</td>' +
                  '</tr>';
                }).join('') || '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:18px;">' + t('该时间段暂无记录', 'No usage in this period') + '</td></tr>';

                const periodLabel = state.granularity === 'month' ? String(yr) : mk;

                // 把 buckets 挂在容器上供悬浮提示取用
                state._lastBuckets = buckets;

                return buildSummaryHtml(data.summary) +
                  '<div class="cg-panel">' +
                    '<div class="cg-panel-head">' +
                      '<div>' +
                        '<div class="cg-panel-title">' + t('按模型统计', 'Usage by model') + '</div>' +
                        '<div class="cg-panel-sub">' + fmtTokShort(periodTotal) + ' Token · ' + periodReqs + ' ' + t('次请求', 'requests') + '</div>' +
                      '</div>' +
                      '<div style="display:flex;align-items:center;gap:10px;">' +
                        '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#cbd5e1;">' +
                          '<button class="cg-icon-btn" id="cg-prev-period">‹</button>' +
                          '<span>' + periodLabel + '</span>' +
                          '<button class="cg-icon-btn" id="cg-next-period">›</button>' +
                        '</div>' +
                        '<div class="cg-seg-group">' +
                          '<button class="cg-seg-btn' + (state.granularity === 'day' ? ' active' : '') + '" data-gran="day">' + t('天', 'Day') + '</button>' +
                          '<button class="cg-seg-btn' + (state.granularity === 'week' ? ' active' : '') + '" data-gran="week">' + t('周', 'Week') + '</button>' +
                          '<button class="cg-seg-btn' + (state.granularity === 'month' ? ' active' : '') + '" data-gran="month">' + t('月', 'Month') + '</button>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="cg-legend">' + legendHtml + '</div>' +
                    '<div class="cg-chart-area">' +
                      '<div class="cg-chart-plot">' + yTicks + barsHtml + '</div>' +
                      '<div class="cg-x-axis">' + xAxisHtml + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="cg-panel" style="padding:10px 14px;">' +
                    '<table class="cg-table">' +
                      '<thead><tr>' +
                        '<th>' + t('模型', 'Model') + '</th>' +
                        '<th>' + t('总 Token', 'Total') + '</th>' +
                        '<th>' + t('未缓存输入', 'Uncached Input') + '</th>' +
                        '<th>' + t('缓存读取', 'Cache Read') + '</th>' +
                        '<th>' + t('缓存写入', 'Cache Write') + '</th>' +
                        '<th>' + t('输出', 'Output') + '</th>' +
                      '</tr></thead>' +
                      '<tbody>' + tableRows + '</tbody>' +
                    '</table>' +
                  '</div>';
              }

              function renderQuotasTab() {
                const groups = state.quotas || [];
                const activeGroupId = resolveQuotaGroupFromModel(window.__catgirl_last_active_model || '').groupId;

                if (!groups.length) {
                  return '<div class="cg-panel" style="text-align:center;padding:30px;color:#94a3b8;">' + t('未能读取账号模型额度（请确认 Antigravity 已登录并点击右上角刷新）', 'Quota summary unavailable. Click refresh to retry.') + '</div>';
                }

                const cardsHtml = groups.map(g => {
                  const isActivePool = g.groupId === activeGroupId;
                  const rowsHtml = (g.buckets || []).map(b => {
                    const pct = (typeof b.pctNum === 'number') ? Math.max(0, Math.min(100, b.pctNum)) : 0;
                    const color = pct <= 15 ? '#f43f5e' : (pct <= 35 ? '#f59e0b' : '#22c55e');
                    const r = 13;
                    const circ = 2 * Math.PI * r;
                    const dashOffset = circ * (1 - pct / 100);
                    const winLabel = b.window === 'weekly' ? t('每周额度 (Weekly limit)', 'Weekly limit') : (b.window === '5h' ? t('5小时额度 (5h limit)', '5h limit') : b.displayName);
                    const resetPrefix = t('重置时间：', 'Resets in ');
                    return '<div class="cg-quota-row">' +
                      '<div>' +
                        '<div style="font-size:12px;font-weight:600;color:#e2e8f0;">' + winLabel + '</div>' +
                        '<div style="font-size:10.5px;color:#94a3b8;margin-top:2px;">' + resetPrefix + (b.countdown || '--') + '</div>' +
                      '</div>' +
                      '<div class="cg-quota-ring-wrap">' +
                        '<span style="font-size:12.5px;font-weight:700;color:' + color + ';">' + Math.round(pct) + '% ' + t('剩余', 'left') + '</span>' +
                        '<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(-90deg);">' +
                          '<circle cx="17" cy="17" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3.2"></circle>' +
                          '<circle cx="17" cy="17" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + dashOffset.toFixed(1) + '"></circle>' +
                        '</svg>' +
                      '</div>' +
                    '</div>';
                  }).join('');

                  return '<div class="cg-quota-card' + (isActivePool ? ' is-active-pool' : '') + '">' +
                    '<div class="cg-quota-card-head">' +
                      '<div class="cg-quota-name">' + g.displayName + '</div>' +
                      (isActivePool ? '<span class="hud-badge" style="background:rgba(16,185,129,0.2);border-color:rgba(52,211,153,0.5);color:#6ee7b7;">' + t('当前使用中', 'Active') + '</span>' : '') +
                    '</div>' +
                    '<div class="cg-quota-desc">' + (g.description || '') + '</div>' +
                    rowsHtml +
                  '</div>';
                }).join('');

                return '<div class="cg-panel">' +
                  '<div class="cg-panel-head">' +
                    '<div>' +
                      '<div class="cg-panel-title">' + t('当前账号全模型配额概览', 'Account Model Quotas') + '</div>' +
                      '<div class="cg-panel-sub">' + t('实时读取官方全部模型池剩余额度与重置倒计时，点击下方小按钮也可在悬浮仪表盘切换预览', 'Live remaining limits across all model pools') + '</div>' +
                    '</div>' +
                    '<button class="cg-icon-btn" id="cg-quota-sync-btn">↻ ' + t('立即刷新额度', 'Refresh Quotas') + '</button>' +
                  '</div>' +
                  '<div class="cg-quota-grid">' + cardsHtml + '</div>' +
                '</div>';
              }

              function renderModal() {
                modal.querySelector('#cg-m-title').textContent = t('用量统计与全模型额度', 'Token usage & Model quotas');
                modal.querySelector('#cg-m-sub').textContent = t('本机 Antigravity · 当前账号', 'Local Antigravity · current account');
                modal.querySelector('#cg-lang-btn').textContent = state.lang === 'en' ? '中' : 'EN';
                modal.querySelector('#cg-tab-activity').textContent = t('活动概览', 'Activity');
                modal.querySelector('#cg-tab-details').textContent = t('用量详情', 'Usage details');
                modal.querySelector('#cg-tab-quotas').textContent = t('全部模型额度', 'Model quotas');

                modal.querySelectorAll('.cg-tab-btn').forEach(btn => {
                  btn.classList.toggle('active', btn.getAttribute('data-tab') === state.tab);
                });

                if (state.tab === 'activity') bodyElModal.innerHTML = renderActivityTab();
                else if (state.tab === 'details') bodyElModal.innerHTML = renderDetailsTab();
                else bodyElModal.innerHTML = renderQuotasTab();

                bindBodyEvents();
              }

              function bindBodyEvents() {
                // Activity events
                bodyElModal.querySelectorAll('[data-heat]').forEach(btn => {
                  btn.addEventListener('click', () => {
                    state.heatMode = btn.getAttribute('data-heat');
                    renderModal();
                  });
                });
                const yrSel = bodyElModal.querySelector('#cg-year-sel');
                if (yrSel) {
                  yrSel.addEventListener('change', () => {
                    state.year = parseInt(yrSel.value, 10);
                    renderModal();
                  });
                }
                bodyElModal.querySelectorAll('.cg-heat-cell[data-date]').forEach(cell => {
                  cell.addEventListener('mouseenter', (ev) => {
                    const dk = cell.getAttribute('data-date');
                    const tot = cell.getAttribute('data-tot');
                    const req = cell.getAttribute('data-req');
                    if (dk) showTip(ev, '<div style="font-weight:700">' + dk + '</div><div>' + fmtNum(tot) + ' Token · ' + req + ' ' + t('次请求', 'requests') + '</div>');
                  });
                  cell.addEventListener('mouseleave', hideTip);
                  cell.addEventListener('click', () => {
                    const dk = cell.getAttribute('data-date');
                    if (dk) {
                      state.selectedDate = dk;
                      state.monthKey = dk.slice(0, 7);
                      renderModal();
                    }
                  });
                });
                const jumpBtn = bodyElModal.querySelector('#cg-jump-details-btn');
                if (jumpBtn) {
                  jumpBtn.addEventListener('click', () => {
                    if (state.selectedDate) state.monthKey = state.selectedDate.slice(0, 7);
                    state.tab = 'details';
                    renderModal();
                  });
                }

                // Details events
                bodyElModal.querySelectorAll('[data-gran]').forEach(btn => {
                  btn.addEventListener('click', () => {
                    state.granularity = btn.getAttribute('data-gran');
                    renderModal();
                  });
                });
                const prevBtn = bodyElModal.querySelector('#cg-prev-period');
                const nextBtn = bodyElModal.querySelector('#cg-next-period');
                function shiftPeriod(delta) {
                  const y = parseInt(state.monthKey.slice(0, 4), 10);
                  const m = parseInt(state.monthKey.slice(5, 7), 10);
                  if (state.granularity === 'month') {
                    state.monthKey = (y + delta) + '-' + String(m).padStart(2, '0');
                  } else {
                    const nd = new Date(y, m - 1 + delta, 1);
                    state.monthKey = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
                  }
                  renderModal();
                }
                if (prevBtn) prevBtn.addEventListener('click', () => shiftPeriod(-1));
                if (nextBtn) nextBtn.addEventListener('click', () => shiftPeriod(1));

                bodyElModal.querySelectorAll('.cg-legend-item[data-model]').forEach(item => {
                  item.addEventListener('click', () => {
                    const m = item.getAttribute('data-model');
                    state.hiddenModels[m] = !state.hiddenModels[m];
                    renderModal();
                  });
                });

                bodyElModal.querySelectorAll('.cg-bar-col[data-bidx]').forEach(col => {
                  col.addEventListener('mouseenter', (ev) => {
                    const idx = parseInt(col.getAttribute('data-bidx'), 10);
                    const b = state._lastBuckets?.[idx];
                    if (!b) return;
                    const lines = Object.entries(b.byModel || {})
                      .filter(([m]) => !state.hiddenModels[m])
                      .sort((a, c) => c[1].total - a[1].total)
                      .map(([m, v]) => '<div>' + m + ': <b>' + fmtNum(v.total) + '</b></div>')
                      .join('');
                    showTip(ev, '<div style="font-weight:700;margin-bottom:3px;">' + b.label + ' (' + fmtNum(b._visibleTotal) + ' tok)</div>' + (lines || '<div style="color:#94a3b8">0 Token</div>'));
                  });
                  col.addEventListener('mouseleave', hideTip);
                });

                const quotaSyncBtn = bodyElModal.querySelector('#cg-quota-sync-btn');
                if (quotaSyncBtn) {
                  quotaSyncBtn.addEventListener('click', () => loadAllData(true));
                }
              }

              modal.querySelectorAll('.cg-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                  state.tab = btn.getAttribute('data-tab');
                  renderModal();
                });
              });
              modal.querySelector('#cg-lang-btn').addEventListener('click', () => {
                state.lang = state.lang === 'zh' ? 'en' : 'zh';
                renderModal();
              });
              modal.querySelector('#cg-refresh-btn').addEventListener('click', () => loadAllData(true));

              loadAllData(false);
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
                positionHudPanel();
                requestAnimationFrame(positionHudPanel);
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
                  window.__antigravityCatgirl.showBubble('已刷新模型配额', 2000);
                }
              });
            }

            // HUD 内快捷切换查看不同模型池额度
            const hudQuotaSwitcher = document.getElementById('live-hud-quota-switcher');
            if (hudQuotaSwitcher) {
              hudQuotaSwitcher.querySelectorAll('.hud-quota-tab[data-pool]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  window.__catgirl_quota_preview_group = btn.getAttribute('data-pool') || 'auto';
                  syncDashboardData(true);
                });
              });
            }

            // HUD 快捷打开“全部模型额度”总览页签
            const hudAllQuotasBtn = document.getElementById('live-hud-all-quotas-btn');
            if (hudAllQuotasBtn) {
              hudAllQuotasBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCatgirlAnalyticsModal('quotas');
              });
            }

            // 图三位置入口按钮：打开“活动概览 + 用量详情 + 全模型额度”统计中心
            const hudAnalyticsEntryBtn = document.getElementById('live-hud-open-analytics-btn');
            if (hudAnalyticsEntryBtn) {
              hudAnalyticsEntryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCatgirlAnalyticsModal('activity');
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
                  showBubble("已打开外部 Dashboard 面板", 2400);
                } else {
                  openCatgirlAnalyticsModal('details');
                }
              });
            }

            // 点击外部关闭 HUD
            document.addEventListener('pointerdown', (e) => {
              const hud = document.getElementById('catgirl-dashboard-hud');
              if (isHudOpen && !dock.contains(e.target) && !(hud && hud.contains(e.target))) {
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

            showBubble("星星猫娘已就绪，点击可互动或右键设置", 2400);
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
