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
  // 下段キャンバスの左上余白（初期状態で重ね画像が上段と同じ画角になるよう補正する量）
  const overlayOffset = { x: 0, y: 0 };

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
    // 下段の重ね画像も同じ画角に（下段のスワイプ移動にはレイヤーごと追従する）
    overlayImage.style.transform =
      `translate(${view.x + overlayOffset.x}px, ${view.y + overlayOffset.y}px) scale(${view.scale})`;
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
  // タッチパッドは細かいイベントが大量に来るため、スクロール量(deltaY)に比例させて拡大率を決める
  // 速度係数：小さいほどゆっくり拡大縮小する
  const WHEEL_ZOOM_SPEED = 0.001;  // マウスホイール1ノッチ(約100)で約10%
  const PINCH_ZOOM_SPEED = 0.004;  // タッチパッドのピンチ操作（ctrlKey付きwheel）
  const TOUCHPAD_PAN_SPEED = 1.0;  // タッチパッド2本指スワイプでの移動速度（1 = 指と同じ量）

  // マウスホイールかタッチパッドかを推定する
  // ・横方向の移動がある → タッチパッド
  // ・行/ページ単位 → マウスホイール
  // ・縦のみで大きめの整数刻み（例: 100, 120） → マウスホイール
  // ・それ以外（小さい値・小数） → タッチパッド
  let lastWheelWasTouchpad = false, lastWheelTime = 0;
  function isTouchpadWheel(e) {
    const now = performance.now();
    let result;
    if (e.deltaX !== 0) result = true;
    else if (e.deltaMode !== 0) result = false;
    else if (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50) result = false;
    else result = true;
    // 連続したスワイプ中は判定を引き継ぐ（慣性スクロールの大きな値でズームに切り替わらないように）
    if (now - lastWheelTime < 150 && lastWheelWasTouchpad) result = true;
    lastWheelWasTouchpad = result;
    lastWheelTime = now;
    return result;
  }
  viewer.addEventListener('wheel', (e) => {
    if (!refImage.naturalWidth) return;
    e.preventDefault();
    const r = viewer.getBoundingClientRect();

    // タッチパッドの2本指スワイプ → 画像を移動
    // （ピンチは ctrlKey 付きで来るのでズーム側へ。マウスホイールは従来どおりズーム）
    if (!e.ctrlKey && isTouchpadWheel(e)) {
      view.x -= e.deltaX * TOUCHPAD_PAN_SPEED;
      view.y -= e.deltaY * TOUCHPAD_PAN_SPEED;
      applyView();
      return;
    }

    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;        // 行単位 → px換算
    else if (e.deltaMode === 2) dy *= 400;  // ページ単位 → px換算
    dy = Math.max(-100, Math.min(100, dy)); // 1回あたりの変化量を制限
    const speed = e.ctrlKey ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    zoomAt(Math.exp(-dy * speed), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // ドラッグで移動 / 2本指ピンチでズーム（スマホ対応）
  // スワイプ（ドラッグ移動）の速度係数：1 = 指と同じ速さ、小さいほどゆっくり動く
  const PAN_SPEED = 0.5;         // 上段（お手本）：指でスワイプした時
  const MOUSE_PAN_SPEED = 1.0;   // 上段（お手本）：マウスで画像をつかんで動かした時（PC）
  const CANVAS_PAN_SPEED = 0.8;  // 下段（描画エリア）※現在は未使用：下段も上段と同じ速度を使う
  const touches = new Map(); // pointerId -> {x, y}
  let gesture = null;
  let viewerPanSpeed = PAN_SPEED;
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
    viewerPanSpeed = e.pointerType === 'mouse' ? MOUSE_PAN_SPEED : PAN_SPEED;
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
      view.x = gesture.ox + (pts[0].x - gesture.sx) * viewerPanSpeed;
      view.y = gesture.oy + (pts[0].y - gesture.sy) * viewerPanSpeed;
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
   *   軽量化のポイント：
   *   - 描画中は previewCanvas に「新しい区間だけ」を描き足す（毎回の全再描画をしない）
   *   - 濃さは previewCanvas の CSS opacity で表現し、確定時に1回だけ合成
   *   - 描画処理は requestAnimationFrame で1フレーム1回にまとめる
   *   - Undo履歴は「変更された矩形範囲だけ」を保存（全画面コピーをしない）
   *   - キャンバスは GPU 描画のまま（willReadFrequently を使わない）
   * ------------------------------------------------------- */
  const wrap = $('canvasWrap');
  const layer = $('canvasLayer');
  const canvasZoomLabel = $('canvasZoomLabel');
  const canvas = $('drawCanvas');
  const preview = $('previewCanvas');
  const ctx = canvas.getContext('2d');
  const pctx = preview.getContext('2d');
  // 確定済み画像の控え（Undo用の「変更前」をここから切り出す）
  const backup = document.createElement('canvas');
  const bctx = backup.getContext('2d');
  // スマホは高DPRでメモリを圧迫するため最大2倍に制限
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const state = {
    tool: 'pen',
    color: '#ffffff',
    size: 4,
    alpha: 1,
    snap: false, // スナップ（PCのShiftキーと同じ：直線45度・正方形・正円）
    magnet: true, // マグネット（方眼の線に吸い寄せる・常にオン）
  };
  // --- マグネット設定（下段の薄い方眼に合わせる） ---
  const MAGNET_GRID = 10;      // 吸い寄せる線の間隔（style.css の #paperGrid の細い線と同じ）
  const MAGNET_RANGE = 4;      // 線からこの距離(px)以内だと吸い寄せられる
  const MAGNET_STRENGTH = 0.9; // 吸い寄せの強さ（0〜1、1で線にぴったり。小さいほど弱い）
  // 線に近いほど強く、範囲の端では0になるので、線がカクッと飛ばない
  function magnetAxis(v) {
    const line = Math.round(v / MAGNET_GRID) * MAGNET_GRID;
    const dist = Math.abs(v - line);
    if (dist >= MAGNET_RANGE) return v;
    return v + (line - v) * MAGNET_STRENGTH * (1 - dist / MAGNET_RANGE);
  }
  // ペン・消しゴム（フリーハンド）には効かせない。直線・四角・円だけに効く
  const applyMagnet = (p, tool) =>
    state.magnet && tool !== 'eraser' && tool !== 'pen' ? { x: magnetAxis(p.x), y: magnetAxis(p.y) } : p;
  let cssW = 0, cssH = 0;
  let drawing = null;

  // --- 下段のスワイプ移動（パン） ---
  // キャンバスは表示領域の2倍（上下左右に半分ずつ余白）を確保し、その範囲内で移動できる
  const pan = { x: 0, y: 0, z: 1 }; // z = 拡大率
  const MAX_CANVAS_ZOOM = 8;
  // 縮小は「キャンバスが表示領域を覆う」ところまで
  const clampZoom = (z) => Math.min(MAX_CANVAS_ZOOM,
    Math.max(cssW ? Math.max(wrap.clientWidth / cssW, wrap.clientHeight / cssH) : 0.1, z));
  function applyPan() {
    pan.z = clampZoom(pan.z);
    const minX = Math.min(0, wrap.clientWidth - cssW * pan.z), minY = Math.min(0, wrap.clientHeight - cssH * pan.z);
    pan.x = Math.min(0, Math.max(minX, pan.x));
    pan.y = Math.min(0, Math.max(minY, pan.y));
    layer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.z})`;
    canvasZoomLabel.textContent = Math.round(pan.z * 100) + '%';
  }
  // 表示領域内の点 (cx, cy) を中心に拡大縮小
  function zoomCanvasAt(factor, cx, cy) {
    const nz = clampZoom(pan.z * factor);
    const k = nz / pan.z;
    pan.x = cx - (cx - pan.x) * k;
    pan.y = cy - (cy - pan.y) * k;
    pan.z = nz;
    applyPan();
  }
  function resetPan() {
    pan.z = 1;
    pan.x = -overlayOffset.x;
    pan.y = -overlayOffset.y;
    applyPan();
  }

  // キャンバスサイズ調整（内容は保持、縮小はしない。再確保を減らすため256px単位で拡張）
  function resizeCanvas() {
    if (drawing) return;
    const needW = wrap.clientWidth * 2, needH = wrap.clientHeight * 2;
    if (needW <= cssW && needH <= cssH) { applyPan(); return; }
    const first = !cssW;
    const w = Math.max(cssW, Math.ceil(needW / 256) * 256);
    const h = Math.max(cssH, Math.ceil(needH / 256) * 256);
    let tmp = null;
    if (cssW) {
      tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = canvas.height;
      tmp.getContext('2d').drawImage(canvas, 0, 0);
    }
    cssW = w; cssH = h;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    for (const c of [canvas, preview]) {
      c.width = W; c.height = H;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    const paperGrid = $('paperGrid');
    paperGrid.style.width = w + 'px';
    paperGrid.style.height = h + 'px';
    backup.width = W; backup.height = H;
    if (tmp) { ctx.drawImage(tmp, 0, 0); bctx.drawImage(tmp, 0, 0); }
    if (first) {
      // 初回：中央が見えるように配置し、重ね画像の位置も合わせる
      overlayOffset.x = Math.round(wrap.clientWidth / 2);
      overlayOffset.y = Math.round(wrap.clientHeight / 2);
      applyView();
      resetPan();
    } else {
      applyPan();
    }
  }
  let resizeQueued = false;
  function requestResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
  }

  // --- 履歴（Undo / Redo）：変更範囲のパッチだけを保存 ---
  const undoStack = [];
  let histIndex = 0;   // 適用済みの件数
  let histBytes = 0;
  const MAX_HISTORY = 100;
  const MAX_BYTES = (IS_MOBILE ? 80 : 300) * 1024 * 1024;
  const entryBytes = (e) => e.before.data.length * 2;

  function clampRect(x, y, w, h) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(canvas.width, Math.ceil(x + w)), y1 = Math.min(canvas.height, Math.ceil(y + h));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  // CSS座標の範囲 → デバイスピクセルの矩形
  function boundsToRect(b, pad) {
    return clampRect((b.minX - pad) * dpr, (b.minY - pad) * dpr,
      (b.maxX - b.minX + pad * 2) * dpr, (b.maxY - b.minY + pad * 2) * dpr);
  }

  function commitHistory(rect) {
    if (!rect) return;
    const { x, y, w, h } = rect;
    const before = bctx.getImageData(x, y, w, h);
    const after = ctx.getImageData(x, y, w, h);
    // 控えを更新
    bctx.clearRect(x, y, w, h);
    bctx.drawImage(canvas, x, y, w, h, x, y, w, h);
    // やり直し分を破棄
    while (undoStack.length > histIndex) histBytes -= entryBytes(undoStack.pop());
    const entry = { rect, before, after };
    undoStack.push(entry);
    histBytes += entryBytes(entry);
    histIndex++;
    while (undoStack.length > MAX_HISTORY || (histBytes > MAX_BYTES && undoStack.length > 1)) {
      histBytes -= entryBytes(undoStack.shift());
      histIndex--;
    }
    updateHistoryButtons();
  }
  function applyPatch(rect, data) {
    ctx.putImageData(data, rect.x, rect.y);
    bctx.putImageData(data, rect.x, rect.y);
  }
  function undo() {
    if (drawing || histIndex <= 0) return;
    const e = undoStack[--histIndex];
    applyPatch(e.rect, e.before);
    updateHistoryButtons();
  }
  function redo() {
    if (drawing || histIndex >= undoStack.length) return;
    const e = undoStack[histIndex++];
    applyPatch(e.rect, e.after);
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $('undoBtn').disabled = histIndex <= 0;
    $('redoBtn').disabled = histIndex >= undoStack.length;
  }

  // --- 描画ヘルパー ---
  const lineWidthFor = (tool) => (tool === 'eraser' ? state.size * 3 : state.size);
  const alphaFor = () => state.alpha;
  const isFreehand = (tool) => tool === 'pen' || tool === 'eraser';

  function setupStroke(c, tool) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = state.color;
    c.fillStyle = state.color;
    c.lineWidth = lineWidthFor(tool);
    c.globalAlpha = 1; // 濃さは確定時に適用
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  }

  // フリーハンド：前回描いた続きの区間だけを描く（なめらかな2次曲線）
  function renderFreehand(d, final) {
    const c = d.tool === 'eraser' ? ctx : pctx;
    const pts = d.pts;
    setupStroke(c, d.tool);
    if (d.drawn === 0) {
      c.beginPath();
      c.arc(pts[0].x, pts[0].y, c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      d.mid = pts[0];
      d.drawn = 1;
    }
    if (pts.length > d.drawn || final) {
      c.beginPath();
      c.moveTo(d.mid.x, d.mid.y);
      for (let i = d.drawn; i < pts.length; i++) {
        const prev = pts[i - 1], cur = pts[i];
        const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
        c.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
        d.mid = mid;
      }
      if (final) {
        const last = pts[pts.length - 1];
        c.lineTo(last.x, last.y);
      }
      c.stroke();
      d.drawn = pts.length;
    }
    c.globalCompositeOperation = 'source-over';
  }

  // 図形：描いた範囲（CSS座標）を返す
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
        const dd = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        x2 = x1 + Math.sign(x2 - x1 || 1) * dd; y2 = y1 + Math.sign(y2 - y1 || 1) * dd;
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
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
  }

  function renderShape(d) {
    if (d.shapeRect) {
      const r = d.shapeRect;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(r.x, r.y, r.w, r.h);
    }
    setupStroke(pctx, d.tool);
    d.bounds = drawShape(pctx, d.tool, d.start, d.last, d.shift);
    d.shapeRect = boundsToRect(d.bounds, lineWidthFor(d.tool) / 2 + 2);
  }

  // --- 塗りつぶし（スキャンライン方式）：変更範囲の矩形を返す ---
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function floodFill(px, py) {
    const W = canvas.width, H = canvas.height;
    const x0 = Math.floor(px * dpr), y0 = Math.floor(py * dpr);
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return null;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const si = (y0 * W + x0) * 4;
    const target = [d[si], d[si + 1], d[si + 2], d[si + 3]];
    const [r, g, b] = hexToRgb(state.color);
    const a = Math.round(state.alpha * 255);
    if (target[0] === r && target[1] === g && target[2] === b && target[3] === a) return null;

    const TOL = 48;
    const visited = new Uint8Array(W * H);
    let minX = x0, maxX = x0, minY = y0, maxY = y0;
    const match = (p) => {
      const i = p * 4;
      return !visited[p] &&
        Math.abs(d[i] - target[0]) <= TOL && Math.abs(d[i + 1] - target[1]) <= TOL &&
        Math.abs(d[i + 2] - target[2]) <= TOL && Math.abs(d[i + 3] - target[3]) <= TOL;
    };
    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      let p = y * W + x;
      while (x > 0 && match(p - 1)) { x--; p--; }
      let up = false, down = false;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      while (x < W && match(p)) {
        const i = p * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; visited[p] = 1;
        if (y > 0) {
          const m = match(p - W);
          if (m && !up) { stack.push(x, y - 1); up = true; } else if (!m) up = false;
        }
        if (y < H - 1) {
          const m = match(p + W);
          if (m && !down) { stack.push(x, y + 1); down = true; } else if (!m) down = false;
        }
        x++; p++;
      }
      if (x - 1 > maxX) maxX = x - 1;
    }
    const rect = clampRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
    ctx.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h); // 変更範囲だけ書き戻す
    return rect;
  }

  // --- ポインター操作 ---
  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!drawing) return;
      if (isFreehand(drawing.tool)) renderFreehand(drawing, false);
      else renderShape(drawing);
    });
  }

  // 画面座標 → キャンバス座標（下段の拡大率を考慮）
  const getPos = (e, r) => ({ x: (e.clientX - r.left) / pan.z, y: (e.clientY - r.top) / pan.z });
  function expand(b, p) {
    if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
    if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
  }

  // --- スワイプ移動：✋ツール / 2本指 / スペース+ドラッグ / マウス中ボタン・右ボタン ---
  const panPointers = new Map(); // pointerId -> {x, y}（画面座標）
  let panGesture = null;
  let spaceDown = false;
  let pendingFill = null;   // タッチの塗りつぶし（指を離すまで保留）
  let lastCanvasTap = 0;
  function panCenter() {
    let x = 0, y = 0;
    for (const p of panPointers.values()) { x += p.x; y += p.y; }
    return { x: x / panPointers.size, y: y / panPointers.size };
  }
  function pointerDist() {
    const [a, b] = panPointers.values();
    return Math.hypot(b.x - a.x, b.y - a.y) || 1;
  }
  let canvasPanSpeed = PAN_SPEED; // 上段と同じ速度（マウス＝MOUSE_PAN_SPEED、指＝PAN_SPEED）
  function startPan() {
    const c = panCenter();
    panGesture = {
      sx: c.x, sy: c.y, px: pan.x, py: pan.y, z: pan.z,
      r: wrap.getBoundingClientRect(),
      dist: panPointers.size >= 2 ? pointerDist() : 0,
      speed: canvasPanSpeed,
    };
    wrap.style.cursor = 'grabbing';
  }
  function endCanvasPan(e) {
    if (!panPointers.delete(e.pointerId)) return false;
    if (panPointers.size) startPan(); // 指が減ったら基準を取り直す
    else { panGesture = null; updateCursor(); }
    return true;
  }
  // 描き始めの線を取り消す（2本指スワイプに切り替える時）
  function cancelDrawing() {
    const d = drawing;
    if (!d) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (d.tool === 'eraser') {
      // 消しゴムは本体に直接描いているので控えから復元
      const r = boundsToRect(d.bounds, lineWidthFor(d.tool) / 2 + 2);
      if (r) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.clearRect(r.x, r.y, r.w, r.h);
        ctx.drawImage(backup, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.restore();
      }
    } else {
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, preview.width, preview.height);
    }
    preview.style.opacity = 1;
    drawing = null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const isMouse = e.pointerType === 'mouse';
    const isTouch = e.pointerType === 'touch';
    if (isMouse && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    // PC：マウスの中ボタン・右ボタンでドラッグすると画像を移動
    const mousePan = isMouse && (e.button === 1 || e.button === 2);
    // 指で描いている／塗りつぶし待ちの最中に2本目の指が触れたら、スワイプ移動に切り替える
    // （PCのスペース+ドラッグと同じように、いつでも移動できる。ペン入力中の手のひらは無視）
    const firstTouch = drawing && drawing.pointerType === 'touch' ? drawing : pendingFill;
    const twoFinger = isTouch && !!firstTouch;
    if (panGesture || twoFinger || state.tool === 'hand' || spaceDown || mousePan) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      canvasPanSpeed = isMouse ? MOUSE_PAN_SPEED : PAN_SPEED;
      if (twoFinger) {
        panPointers.set(firstTouch.id, firstTouch.client);
        if (pendingFill) pendingFill = null;
        else if (performance.now() - drawing.t0 < 300) cancelDrawing(); // 描き始めの誤線は取り消す
        else finishDrawing(); // しっかり描いた線は残して確定
      }
      panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (panPointers.size === 1 && isTouch && state.tool === 'hand') {
        // ✋ツールのダブルタップで位置リセット（PCのダブルクリックと同じ）
        const now = performance.now();
        if (now - lastCanvasTap < 300) { resetPan(); lastCanvasTap = 0; } else lastCanvasTap = now;
      }
      startPan();
      return;
    }
    if (isMouse && e.button !== 0) return;
    if (drawing || pendingFill) return; // 描画中のペン以外の入力・手のひらは無視
    e.preventDefault();
    const rect = canvas.getBoundingClientRect(); // 描画中はキャッシュして使う
    const p = getPos(e, rect);
    const tool = state.tool;

    if (tool === 'fill') {
      if (isTouch) {
        // タッチは2本指スワイプと区別するため、指を離した時に塗る
        canvas.setPointerCapture(e.pointerId);
        pendingFill = { id: e.pointerId, p, client: { x: e.clientX, y: e.clientY }, start: { x: e.clientX, y: e.clientY } };
      } else {
        commitHistory(floodFill(p.x, p.y));
      }
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const snap = e.shiftKey || state.snap;
    const mp = applyMagnet(p, tool);
    drawing = {
      id: e.pointerId, tool, rect, pts: [mp], start: mp, last: mp, shift: snap,
      drawn: 0, mid: mp, bounds: { minX: mp.x, minY: mp.y, maxX: mp.x, maxY: mp.y }, shapeRect: null,
      pointerType: e.pointerType, t0: performance.now(), client: { x: e.clientX, y: e.clientY },
    };
    preview.style.opacity = tool === 'eraser' ? 1 : alphaFor(tool);
    if (isFreehand(tool)) renderFreehand(drawing, false);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (panPointers.has(e.pointerId)) {
      panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = panGesture;
      const c = panCenter();
      // 2本指なら指の間隔の変化で拡大縮小（ピンチ）
      let z = g.z;
      if (g.dist && panPointers.size >= 2) z = g.z * pointerDist() / g.dist;
      z = clampZoom(z);
      // 開始時に指の中心にあった点が、移動後の中心に来るように
      const sx = g.sx - g.r.left, sy = g.sy - g.r.top;
      const lx = (sx - g.px) / g.z, ly = (sy - g.py) / g.z;
      pan.z = z;
      pan.x = sx + (c.x - g.sx) * g.speed - lx * z;
      pan.y = sy + (c.y - g.sy) * g.speed - ly * z;
      applyPan();
      return;
    }
    if (pendingFill && e.pointerId === pendingFill.id) {
      pendingFill.client = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drawing || e.pointerId !== drawing.id) return;
    const d = drawing;
    d.client = { x: e.clientX, y: e.clientY };
    if (isFreehand(d.tool)) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events) {
        const p = applyMagnet(getPos(ev, d.rect), d.tool);
        const last = d.pts[d.pts.length - 1];
        if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 0.75) continue; // 細かすぎる点は間引く
        d.pts.push(p);
        expand(d.bounds, p);
      }
    } else {
      d.last = applyMagnet(getPos(e, d.rect), d.tool);
      d.shift = e.shiftKey || state.snap;
    }
    scheduleRender();
  });

  function endDraw(e) {
    if (endCanvasPan(e)) return;
    if (pendingFill && e.pointerId === pendingFill.id) {
      const f = pendingFill;
      pendingFill = null;
      const moved = Math.hypot(f.client.x - f.start.x, f.client.y - f.start.y);
      if (e.type === 'pointerup' && moved < 10) commitHistory(floodFill(f.p.x, f.p.y));
      return;
    }
    if (!drawing || e.pointerId !== drawing.id) return;
    finishDrawing();
  }
  function finishDrawing() {
    if (!drawing) return;
    const d = drawing;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    let rect;
    if (isFreehand(d.tool)) {
      renderFreehand(d, true);
      rect = boundsToRect(d.bounds, lineWidthFor(d.tool) / 2 + 2);
    } else {
      renderShape(d);
      rect = d.shapeRect;
    }
    if (rect && d.tool !== 'eraser') {
      // プレビューを1回だけ本体へ合成し、その範囲だけ消す
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alphaFor(d.tool);
      ctx.drawImage(preview, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    }
    preview.style.opacity = 1;
    drawing = null;
    commitHistory(rect);
  }
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  // --- ツールバー ---
  const toolButtons = document.querySelectorAll('#toolGroup .tool');
  function updateCursor() {
    if (panGesture) return;
    wrap.style.cursor = state.tool === 'hand' || spaceDown ? 'grab' : state.tool === 'fill' ? 'cell' : 'crosshair';
  }
  function setTool(t) {
    state.tool = t;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    updateCursor();
  }
  toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  // ✋ツールでダブルクリック／ダブルタップすると位置をリセット
  wrap.addEventListener('dblclick', () => { if (state.tool === 'hand') resetPan(); });
  // 下段もホイールで拡大縮小（PC）
  // 上段と同じ操作感：タッチパッド2本指スワイプ＝移動、ピンチ／マウスホイール＝拡大縮小
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (drawing) return;
    const r = wrap.getBoundingClientRect();
    if (!e.ctrlKey && isTouchpadWheel(e)) {
      pan.x -= e.deltaX * TOUCHPAD_PAN_SPEED;
      pan.y -= e.deltaY * TOUCHPAD_PAN_SPEED;
      applyPan();
      return;
    }
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    dy = Math.max(-100, Math.min(100, dy));
    const speed = e.ctrlKey ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    zoomCanvasAt(Math.exp(-dy * speed), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  const canvasCenterZoom = (f) => zoomCanvasAt(f, wrap.clientWidth / 2, wrap.clientHeight / 2);
  $('canvasZoomInBtn').onclick = () => canvasCenterZoom(1.25);
  $('canvasZoomOutBtn').onclick = () => canvasCenterZoom(0.8);
  canvasZoomLabel.onclick = resetPan;


  // 並び：赤、緑、青、紫、オレンジ、黄色、白、黒
  const PALETTE = ['#e53935', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#fdd835', '#ffffff', '#222222'];
  const paletteEl = $('palette');
  // 選択中の色のサークルを白く囲む
  function selectColor(c) {
    state.color = c;
    paletteEl.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('selected', s.dataset.color === c));
  }
  PALETTE.forEach((c) => {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.background = c;
    s.title = c;
    s.dataset.color = c;
    s.onclick = () => selectColor(c);
    paletteEl.appendChild(s);
  });
  selectColor(state.color);


  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => {
    if (!confirm('描いた内容をすべて消去しますか？')) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    commitHistory(clampRect(0, 0, canvas.width, canvas.height));
  };

  function save() {
    // 表示領域ぶん（スワイプ・拡大した見た目のまま）を黒背景で書き出し
    const w = Math.round(wrap.clientWidth * dpr), h = Math.round(wrap.clientHeight * dpr);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d');
    o.fillStyle = '#000';
    o.fillRect(0, 0, w, h);
    o.imageSmoothingQuality = 'high';
    o.drawImage(canvas, -pan.x / pan.z * dpr, -pan.y / pan.z * dpr, w / pan.z, h / pan.z, 0, 0, w, h);
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
  overlayImage.style.opacity = 0.3; // 重ね画像の透明度（固定）

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
      requestResize();
    };
    const up = () => {
      splitter.classList.remove('active');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up); // Androidでジェスチャーが中断された時も確実に終了
  });

  window.addEventListener('resize', requestResize);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox')) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); save(); }
      return;
    }
    const map = { p: 'pen', l: 'line', r: 'rect', o: 'ellipse', f: 'fill', h: 'hand' };
    if (e.key === ' ') {
      // スペースを押している間はドラッグで下段を移動
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; updateCursor(); }
      return;
    }
    if (map[k]) setTool(map[k]);
    else if (k === 't') toggleOverlay();
    else if (e.key === 'ArrowLeft') showImage(currentIndex - 1);
    else if (e.key === 'ArrowRight') showImage(currentIndex + 1);
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && spaceDown) { spaceDown = false; updateCursor(); }
  });

  // 初期化
  resizeCanvas();
  updateHistoryButtons();
})();
