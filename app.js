/* =========================================================
 * お手本トレース - 上：お手本画像ビューア / 下：描画キャンバス
 * ========================================================= */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (IS_MOBILE) document.body.classList.add('mobile');

  /* ---------------------------------------------------------
   * 1. お手本画像ビューア（上段）
   * ------------------------------------------------------- */
  const viewer = $('viewer');
  const refImage = $('refImage');
  const overlayImage = $('overlayImage');
  const dropHint = $('dropHint');
  const imageSelect = $('imageSelect');
  const zoomLabel = $('zoomLabel');

  let images = [];          // { name, url }
  let currentIndex = -1;
  const view = { scale: 1, x: 0, y: 0 };

  const isImage = (f) => f.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|bmp|webp|svg|avif)$/i.test(f.name);

  function loadFiles(fileList) {
    const files = Array.from(fileList).filter(isImage);
    if (!files.length) { alert('画像ファイルが見つかりませんでした。'); return; }
    files.sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'ja', { numeric: true }));

    images.forEach((im) => URL.revokeObjectURL(im.url));
    images = files.map((f) => ({ name: f.webkitRelativePath || f.name, url: URL.createObjectURL(f) }));

    imageSelect.innerHTML = '';
    images.forEach((im, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i + 1}/${images.length}  ${im.name}`;
      imageSelect.appendChild(opt);
    });
    showImage(0);
  }

  function showImage(i) {
    if (!images.length) return;
    currentIndex = (i + images.length) % images.length;
    imageSelect.value = currentIndex;
    refImage.onload = () => {
      refImage.style.display = 'block';
      dropHint.style.display = 'none';
      overlayImage.src = refImage.src;
      fitImage();
    };
    refImage.src = images[currentIndex].url;
  }

  function applyView() {
    const t = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    refImage.style.transform = t;
    overlayImage.style.transform = t; // 下段の重ね画像も同じ画角に
    zoomLabel.textContent = Math.round(view.scale * 100) + '%';
  }

  function fitImage() {
    if (!refImage.naturalWidth) return;
    const vw = viewer.clientWidth, vh = viewer.clientHeight;
    const iw = refImage.naturalWidth, ih = refImage.naturalHeight;
    view.scale = Math.min(vw / iw, vh / ih) * 0.95;
    view.x = (vw - iw * view.scale) / 2;
    view.y = (vh - ih * view.scale) / 2;
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    const ns = Math.min(20, Math.max(0.05, view.scale * factor));
    const k = ns / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = ns;
    applyView();
  }
  const zoomCenter = (f) => zoomAt(f, viewer.clientWidth / 2, viewer.clientHeight / 2);

  $('folderInput').addEventListener('change', (e) => { if (e.target.files.length) loadFiles(e.target.files); e.target.value = ''; });
  $('fileInput').addEventListener('change', (e) => { if (e.target.files.length) loadFiles(e.target.files); e.target.value = ''; });
  $('prevBtn').onclick = () => showImage(currentIndex - 1);
  $('nextBtn').onclick = () => showImage(currentIndex + 1);
  imageSelect.onchange = () => showImage(+imageSelect.value);
  $('zoomInBtn').onclick = () => zoomCenter(1.25);
  $('zoomOutBtn').onclick = () => zoomCenter(0.8);
  $('fitBtn').onclick = fitImage;

  // ホイールでズーム
  viewer.addEventListener('wheel', (e) => {
    if (!refImage.naturalWidth) return;
    e.preventDefault();
    const r = viewer.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // ドラッグで移動 / 2本指ピンチでズーム（スマホ対応）
  const touches = new Map(); // pointerId -> {x, y}
  let gesture = null;
  const localPt = (e) => {
    const r = viewer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function startGesture() {
    const pts = [...touches.values()];
    if (pts.length === 1) {
      gesture = { type: 'pan', sx: pts[0].x, sy: pts[0].y, ox: view.x, oy: view.y };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = {
        type: 'pinch',
        dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
        scale: view.scale, ox: view.x, oy: view.y,
      };
    }
  }
  viewer.addEventListener('pointerdown', (e) => {
    viewer.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, localPt(e));
    viewer.classList.add('dragging');
    startGesture();
  });
  viewer.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId) || !gesture) return;
    touches.set(e.pointerId, localPt(e));
    const pts = [...touches.values()];
    if (gesture.type === 'pan') {
      view.x = gesture.ox + pts[0].x - gesture.sx;
      view.y = gesture.oy + pts[0].y - gesture.sy;
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const ns = Math.min(20, Math.max(0.05, gesture.scale * Math.hypot(b.x - a.x, b.y - a.y) / gesture.dist));
      const k = ns / gesture.scale;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      // 開始時の中心点が、現在の中心点に来るように
      view.x = cx - (gesture.cx - gesture.ox) * k;
      view.y = cy - (gesture.cy - gesture.oy) * k;
      view.scale = ns;
    }
    applyView();
  });
  let lastTap = 0;
  const endPan = (e) => {
    const p = touches.get(e.pointerId);
    const isTap = gesture && gesture.type === 'pan' && p &&
      Math.hypot(p.x - gesture.sx, p.y - gesture.sy) < 10;
    touches.delete(e.pointerId);
    if (touches.size) { startGesture(); return; }
    gesture = null;
    viewer.classList.remove('dragging');
    // ダブルタップで全体表示（タッチ用）
    if (e.type === 'pointerup' && e.pointerType === 'touch' && isTap) {
      const now = Date.now();
      if (now - lastTap < 300) { fitImage(); lastTap = 0; } else lastTap = now;
    }
  };
  viewer.addEventListener('pointerup', endPan);
  viewer.addEventListener('pointercancel', endPan);
  viewer.addEventListener('dblclick', fitImage);

  // ドラッグ＆ドロップ
  viewer.addEventListener('dragover', (e) => { e.preventDefault(); viewer.classList.add('dragover'); });
  viewer.addEventListener('dragleave', () => viewer.classList.remove('dragleave', 'dragover'));
  viewer.addEventListener('drop', (e) => {
    e.preventDefault();
    viewer.classList.remove('dragover');
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  /* ---------------------------------------------------------
   * 2. 描画キャンバス（下段）
   * ------------------------------------------------------- */
  const wrap = $('canvasWrap');
  const canvas = $('drawCanvas');
  const preview = $('previewCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pctx = preview.getContext('2d');
  // スマホは高DPRでメモリを圧迫するため最大2倍に制限
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const state = {
    tool: 'pen',
    color: '#ffffff',
    size: 4,
    alpha: 1,
  };
  let cssW = 0, cssH = 0;

  // キャンバスサイズ調整（内容は保持、縮小はしない）
  function resizeCanvas() {
    const w = Math.max(cssW, wrap.clientWidth);
    const h = Math.max(cssH, wrap.clientHeight);
    if (w === cssW && h === cssH) return;
    const old = cssW ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    cssW = w; cssH = h;
    for (const c of [canvas, preview]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    if (old) ctx.putImageData(old, 0, 0);
    if (!history.length) pushHistory();
  }

  // --- 履歴（Undo / Redo） ---
  const history = [];
  let histIndex = -1;
  const MAX_HISTORY = IS_MOBILE ? 15 : 40;

  function pushHistory() {
    history.splice(histIndex + 1);
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > MAX_HISTORY) history.shift();
    histIndex = history.length - 1;
    updateHistoryButtons();
  }
  function restore(i) {
    histIndex = i;
    const snap = history[i];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(snap, 0, 0);
    updateHistoryButtons();
  }
  const undo = () => { if (histIndex > 0) restore(histIndex - 1); };
  const redo = () => { if (histIndex < history.length - 1) restore(histIndex + 1); };
  function updateHistoryButtons() {
    $('undoBtn').disabled = histIndex <= 0;
    $('redoBtn').disabled = histIndex >= history.length - 1;
  }

  // --- 描画ヘルパー ---
  function setupStroke(c, tool) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = state.color;
    c.fillStyle = state.color;
    c.lineWidth = tool === 'marker' ? state.size * 3 : state.size;
    c.globalAlpha = tool === 'marker' ? Math.min(state.alpha, 0.4) : state.alpha;
    c.globalCompositeOperation = 'source-over';
  }

  function drawPath(c, pts) {
    c.beginPath();
    if (pts.length === 1) {
      c.arc(pts[0].x, pts[0].y, c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
  }

  function drawShape(c, tool, a, b, shift) {
    let { x: x1, y: y1 } = a, { x: x2, y: y2 } = b;
    if (shift) {
      if (tool === 'line') {
        // 45度単位にスナップ
        const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x2 - x1, y2 - y1);
        x2 = x1 + Math.cos(ang) * len; y2 = y1 + Math.sin(ang) * len;
      } else {
        // 正方形・正円
        const d = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        x2 = x1 + Math.sign(x2 - x1 || 1) * d; y2 = y1 + Math.sign(y2 - y1 || 1) * d;
      }
    }
    c.beginPath();
    if (tool === 'line') {
      c.moveTo(x1, y1); c.lineTo(x2, y2);
    } else if (tool === 'rect') {
      c.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (tool === 'ellipse') {
      c.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    }
    c.stroke();
  }

  const clearPreview = () => {
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, preview.width, preview.height);
  };

  // --- 塗りつぶし（スキャンライン方式） ---
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function floodFill(px, py) {
    const W = canvas.width, H = canvas.height;
    const x0 = Math.floor(px * dpr), y0 = Math.floor(py * dpr);
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return false;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const si = (y0 * W + x0) * 4;
    const target = [d[si], d[si + 1], d[si + 2], d[si + 3]];
    const [r, g, b] = hexToRgb(state.color);
    const a = Math.round(state.alpha * 255);
    if (target[0] === r && target[1] === g && target[2] === b && target[3] === a) return false;

    const TOL = 48;
    const visited = new Uint8Array(W * H);
    const match = (p) => {
      const i = p * 4;
      return !visited[p] &&
        Math.abs(d[i] - target[0]) <= TOL && Math.abs(d[i + 1] - target[1]) <= TOL &&
        Math.abs(d[i + 2] - target[2]) <= TOL && Math.abs(d[i + 3] - target[3]) <= TOL;
    };
    const paint = (p) => {
      const i = p * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; visited[p] = 1;
    };
    const stack = [[x0, y0]];
    while (stack.length) {
      let [x, y] = stack.pop();
      let p = y * W + x;
      while (x > 0 && match(p - 1)) { x--; p--; }
      let up = false, down = false;
      while (x < W && match(p)) {
        paint(p);
        if (y > 0) {
          const m = match(p - W);
          if (m && !up) { stack.push([x, y - 1]); up = true; } else if (!m) up = false;
        }
        if (y < H - 1) {
          const m = match(p + W);
          if (m && !down) { stack.push([x, y + 1]); down = true; } else if (!m) down = false;
        }
        x++; p++;
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  // --- ポインター操作 ---
  let drawing = null; // { tool, pts, start, last }

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (drawing) return; // 描画中の2本目の指・手のひらは無視
    e.preventDefault();
    const p = getPos(e);
    const tool = state.tool;

    if (tool === 'fill') {
      if (floodFill(p.x, p.y)) pushHistory();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drawing = { id: e.pointerId, tool, pts: [p], start: p, last: p };

    if (tool === 'eraser') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = state.size * 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (tool === 'pen' || tool === 'marker') {
      setupStroke(pctx, tool);
      drawPath(pctx, drawing.pts);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const tool = drawing.tool;

    if (tool === 'pen' || tool === 'marker') {
      for (const ev of events) drawing.pts.push(getPos(ev));
      clearPreview();
      setupStroke(pctx, tool);
      drawPath(pctx, drawing.pts);
    } else if (tool === 'eraser') {
      for (const ev of events) {
        const p = getPos(ev);
        ctx.beginPath();
        ctx.moveTo(drawing.last.x, drawing.last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        drawing.last = p;
      }
    } else {
      drawing.last = getPos(e);
      clearPreview();
      setupStroke(pctx, tool);
      drawShape(pctx, tool, drawing.start, drawing.last, e.shiftKey);
    }
  });

  function endDraw(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    const tool = drawing.tool;
    if (tool === 'pen' || tool === 'marker') {
      setupStroke(ctx, tool);
      drawPath(ctx, drawing.pts);
    } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      setupStroke(ctx, tool);
      drawShape(ctx, tool, drawing.start, drawing.last, e && e.shiftKey);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    clearPreview();
    drawing = null;
    pushHistory();
  }
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  // --- ツールバー ---
  const toolButtons = document.querySelectorAll('#toolGroup .tool');
  function setTool(t) {
    state.tool = t;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    wrap.style.cursor = t === 'fill' ? 'cell' : 'crosshair';
  }
  toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));

  const colorPicker = $('colorPicker');
  colorPicker.oninput = () => (state.color = colorPicker.value);

  const PALETTE = ['#222222', '#ffffff', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#9e9e9e'];
  const paletteEl = $('palette');
  PALETTE.forEach((c) => {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.background = c;
    s.title = c;
    s.onclick = () => { state.color = c; colorPicker.value = c; };
    paletteEl.appendChild(s);
  });

  const sizeRange = $('sizeRange');
  sizeRange.oninput = () => { state.size = +sizeRange.value; $('sizeLabel').textContent = sizeRange.value; };
  $('alphaRange').oninput = (e) => (state.alpha = +e.target.value / 100);

  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => {
    if (!confirm('描いた内容をすべて消去しますか？')) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pushHistory();
  };

  function save() {
    // 表示領域ぶんを黒背景で書き出し
    const w = Math.round(wrap.clientWidth * dpr), h = Math.round(wrap.clientHeight * dpr);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d');
    o.fillStyle = '#000';
    o.fillRect(0, 0, w, h);
    o.drawImage(canvas, 0, 0);
    const base = images[currentIndex] ? images[currentIndex].name.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'drawing';
    const filename = `${base}_trace_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    out.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = filename;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }
  $('saveBtn').onclick = save;

  // スマホの長押しメニューを抑止
  [wrap, viewer].forEach((el) => el.addEventListener('contextmenu', (e) => e.preventDefault()));

  // --- お手本の重ね表示（上と同じ画角で薄く表示。保存には含まれない） ---
  const overlayBtn = $('overlayBtn');
  function toggleOverlay(force) {
    const on = document.body.classList.toggle('show-overlay', force);
    overlayBtn.classList.toggle('active', on);
  }
  overlayBtn.onclick = () => toggleOverlay();
  const overlayAlpha = $('overlayAlpha');
  overlayAlpha.oninput = () => (overlayImage.style.opacity = overlayAlpha.value / 100);
  overlayAlpha.oninput();

  /* ---------------------------------------------------------
   * 3. グリッド・仕切り・ショートカット
   * ------------------------------------------------------- */
  const gridSize = $('gridSize');
  const updateGrid = () => {
    document.querySelectorAll('.grid-overlay').forEach((g) => g.style.setProperty('--g', gridSize.value + 'px'));
  };
  $('gridToggle').onchange = (e) => document.body.classList.toggle('show-grid', e.target.checked);
  gridSize.oninput = updateGrid;
  updateGrid();

  // 上下の仕切りドラッグ
  const splitter = $('splitter');
  const topPane = $('topPane');
  splitter.addEventListener('pointerdown', (e) => {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('active');
    const move = (ev) => {
      const h = window.innerHeight;
      const y = Math.min(h - 120, Math.max(80, ev.clientY));
      topPane.style.flexBasis = y + 'px';
      resizeCanvas();
    };
    const up = () => {
      splitter.classList.remove('active');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
  });

  window.addEventListener('resize', resizeCanvas);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox')) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); save(); }
      return;
    }
    const map = { p: 'pen', m: 'marker', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', f: 'fill' };
    if (map[k]) setTool(map[k]);
    else if (k === 't') toggleOverlay();
    else if (e.key === 'ArrowLeft') showImage(currentIndex - 1);
    else if (e.key === 'ArrowRight') showImage(currentIndex + 1);
    else if (e.key === '[') { sizeRange.value = Math.max(1, state.size - 1); sizeRange.oninput(); }
    else if (e.key === ']') { sizeRange.value = Math.min(60, state.size + 1); sizeRange.oninput(); }
  });

  // 初期化
  resizeCanvas();
  updateHistoryButtons();
})();
