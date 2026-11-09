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
  const pan = { x: 0, y: 0, z: 1 }; // 下段の移動量・拡大率

  const isImage = (f) => f.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|bmp|webp|svg|avif)$/i.test(f.name);

  function loadFiles(fileList, append = false) {
    const files = Array.from(fileList).filter(isImage);
    if (!files.length) { alert('画像ファイルが見つかりませんでした。'); return; }
    files.sort((a, b) =>
      (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'ja', { numeric: true }));

    let targetIndex = 0;
    if (append && images.length) {
      targetIndex = images.length;
      files.forEach((f) => {
        const name = f.webkitRelativePath || f.name;
        const url = URL.createObjectURL(f);
        const existIdx = images.findIndex((im) => im.name === name);
        if (existIdx !== -1) {
          URL.revokeObjectURL(images[existIdx].url);
          images[existIdx].url = url;
          if (files.length === 1) targetIndex = existIdx;
        } else {
          images.push({ name, url });
        }
      });
      if (targetIndex >= images.length) targetIndex = images.length - 1;
    } else {
      images.forEach((im) => URL.revokeObjectURL(im.url));
      images = files.map((f) => ({ name: f.webkitRelativePath || f.name, url: URL.createObjectURL(f) }));
    }

    imageSelect.innerHTML = '';
    images.forEach((im, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i + 1}/${images.length}  ${im.name}`;
      imageSelect.appendChild(opt);
    });
    showImage(targetIndex);
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
      syncOverlay();
    };
    refImage.src = images[currentIndex].url;
  }

  function applyView() {
    const t = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    refImage.style.transform = t;
    setLabel(zoomLabel, Math.round(view.scale * 100) + '%');
  }
  // 下段の重ね画像は上段とは連動させない（上段を動かしても下段の重ね画像は動かない）
  // 画像を読み込んだ時・重ね表示をオンにした時だけ、その時点の上段の画角に合わせる
  const overlayView = { scale: 1, x: 0, y: 0 };
  function syncOverlay() {
    Object.assign(overlayView, view);
    if (typeof syncOverlayView === 'function') syncOverlayView();
    else applyOverlay();
  }
  function applyOverlay() {
    const ox = pan.x + overlayView.x * pan.z;
    const oy = pan.y + overlayView.y * pan.z;
    const os = overlayView.scale * pan.z;
    overlayImage.style.transform = `translate3d(${ox}px, ${oy}px, 0) scale(${os})`;
  }
  // 表示が変わる時だけ文字を書き換える（移動中に毎回書き換えるとレイアウト計算が走りカクつくため）
  function setLabel(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
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
    const ns = Math.min(30, Math.max(0.05, view.scale * factor));
    const k = ns / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = ns;
    applyView();
  }
  const zoomCenter = (f) => zoomAt(f, viewer.clientWidth / 2, viewer.clientHeight / 2);

  $('folderInput').addEventListener('change', (e) => { if (e.target.files.length) loadFiles(e.target.files, false); e.target.value = ''; });
  $('fileInput').addEventListener('change', (e) => { if (e.target.files.length) loadFiles(e.target.files, true); e.target.value = ''; });
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
  let viewRafId = 0;
  const localPt = (e) => {
    const r = viewer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function startGesture() {
    // 反映待ちの移動があれば先に確定（指の本数が変わった時に位置が跳ねないように）
    if (viewRafId) { cancelAnimationFrame(viewRafId); viewRafId = 0; applyView(); }
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
      const ns = Math.min(30, Math.max(0.05, gesture.scale * Math.hypot(b.x - a.x, b.y - a.y) / gesture.dist));
      const k = ns / gesture.scale;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      // 開始時の中心点が、現在の中心点に来るように
      view.x = cx - (gesture.cx - gesture.ox) * k;
      view.y = cy - (gesture.cy - gesture.oy) * k;
      view.scale = ns;
    }
    // 1フレーム1回にまとめて反映
    if (!viewRafId) viewRafId = requestAnimationFrame(() => { viewRafId = 0; applyView(); });
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
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files, true);
  });

  /* ---------------------------------------------------------
   * 2. 描画キャンバス（下段）
   *   高倍率ズーム＆軽量描画のポイント：
   *   - キャンバスは常に「現在の表示領域サイズ × DPR」で保持し、拡大しても線がぼやけない
   *   - 線の太さ・文字サイズは描画時の画面拡大率(1 / pan.z)に合わせて自動調整
   *   - 2本指スワイプ・ピンチ中は GPU CSS transform だけで滑らかに移動し、指を離した時にくっきり再描画
   *   - 描画中は previewCanvas に「新しい区間だけ」を描き足し、確定時に1回だけ合成
   *   - ストロークをベクター履歴で保持し、画面外の線・区間はカリングして高速再描画
   * ------------------------------------------------------- */
  const wrap = $('canvasWrap');
  const layer = $('canvasLayer');
  const canvasZoomLabel = $('canvasZoomLabel');
  const paperGrid = $('paperGrid');
  const canvas = $('drawCanvas');
  const preview = $('previewCanvas');
  const gctx = paperGrid.getContext('2d');
  const ctx = canvas.getContext('2d');
  const pctx = preview.getContext('2d');
  // スマホは高DPRでメモリを圧迫するため最大2倍に制限
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const state = {
    tool: 'pen',
    color: '#ffffff',
    size: 8, // デフォルトの線の太さ（従来の4pxから2倍の8px）
    alpha: 0.85, // えんぴつ風の質感は残しつつ、しっかり見やすい濃さに
    snap: false, // スナップ（PCのShiftキーと同じ：直線45度・正方形）
    magnet: true, // マグネット（方眼の線に吸い寄せる・常にオン）
    showPaperGrid: true, // 下段の方眼グリッド表示
  };
  // --- マグネット設定（下段の薄い方眼に合わせる） ---
  const MAGNET_GRID = 10;      // 吸い寄せる線の間隔（ワールド座標10px）
  const MAGNET_RANGE = 4;      // 線から画面上でこの距離(px)以内だと吸い寄せられる
  const MAGNET_STRENGTH = 0.9; // 吸い寄せの強さ（0〜1、1で線にぴったり。小さいほど弱い）
  // 線に近いほど強く、範囲の端では0になるので、線がカクッと飛ばない
  function magnetAxis(v, z) {
    const line = Math.round(v / MAGNET_GRID) * MAGNET_GRID;
    const dist = Math.abs(v - line);
    const range = MAGNET_RANGE / z;
    if (dist >= range) return v;
    return v + (line - v) * MAGNET_STRENGTH * (1 - dist / range);
  }
  // ペン（フリーハンド）には効かせない。直線・四角だけに効く（方眼オフ時は無効）
  const applyMagnet = (p, tool, z) =>
    state.magnet && state.showPaperGrid && tool !== 'pen' ? { x: magnetAxis(p.x, z), y: magnetAxis(p.y, z) } : p;

  let viewW = 0, viewH = 0;
  let drawing = null;
  const renderedView = { x: 0, y: 0, z: 1 };
  let wheelSyncTimer = 0;

  // --- 下段のスワイプ移動（パン）・拡大縮小 ---
  const MIN_CANVAS_ZOOM = 0.25;
  // 重ねたお手本画像が全体表示で縮小されていても、元画像の細部まで十分拡大できるように上限を拡張（最低4000%・最大10000%）
  const maxCanvasZoom = () =>
    Math.min(100, Math.max(40, refImage.naturalWidth && overlayView.scale ? Math.ceil(30 / overlayView.scale) : 40));
  const clampZoom = (z) => Math.min(maxCanvasZoom(), Math.max(MIN_CANVAS_ZOOM, z));

  function applyPan() {
    pan.z = clampZoom(pan.z);
    const vw = viewW || wrap.clientWidth || 1;
    const vh = viewH || wrap.clientHeight || 1;
    // 描画可能範囲：面積で従来(3×3画面=9倍)の4倍(6×6画面=36倍)。画面を中心に拡張
    let wMinX = -vw * 2.5, wMaxX = vw * 3.5, wMinY = -vh * 2.5, wMaxY = vh * 3.5;
    if (refImage.naturalWidth) {
      const ix0 = overlayView.x, iy0 = overlayView.y;
      const ix1 = ix0 + refImage.naturalWidth * overlayView.scale;
      const iy1 = iy0 + refImage.naturalHeight * overlayView.scale;
      wMinX = Math.min(wMinX, ix0 - vw * 0.5);
      wMaxX = Math.max(wMaxX, ix1 + vw * 0.5);
      wMinY = Math.min(wMinY, iy0 - vh * 0.5);
      wMaxY = Math.max(wMaxY, iy1 + vh * 0.5);
    }
    const minPanX = vw * 0.5 - wMaxX * pan.z, maxPanX = vw * 0.5 - wMinX * pan.z;
    const minPanY = vh * 0.5 - wMaxY * pan.z, maxPanY = vh * 0.5 - wMinY * pan.z;
    pan.x = Math.min(maxPanX, Math.max(minPanX, pan.x));
    pan.y = Math.min(maxPanY, Math.max(minPanY, pan.y));

    const k = pan.z / renderedView.z;
    const dx = pan.x - renderedView.x * k;
    const dy = pan.y - renderedView.y * k;
    layer.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${k})`;
    applyOverlay();
    setLabel(canvasZoomLabel, Math.round(pan.z * 100) + '%');
  }

  function syncOverlayView() {
    applyPan();
  }

  // スワイプ中の移動反映は1フレーム1回にまとめる
  let panRafId = 0;
  function schedulePan() {
    if (panRafId) return;
    panRafId = requestAnimationFrame(() => { panRafId = 0; applyPan(); });
  }

  function drawPaperGrid() {
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, paperGrid.width, paperGrid.height);
    if (!state.showPaperGrid || !viewW || !viewH) return;
    const vz = renderedView.z, vx = renderedView.x, vy = renderedView.y;
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.lineWidth = 1;

    const minor = 10 * vz;
    if (minor >= 4) {
      gctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
      gctx.beginPath();
      const i0 = Math.ceil((-vx) / minor), i1 = Math.floor((viewW - vx) / minor);
      for (let i = i0; i <= i1; i++) {
        if (i % 5 === 0) continue;
        const x = Math.floor(vx + i * 10 * vz) + 0.5;
        gctx.moveTo(x, 0); gctx.lineTo(x, viewH);
      }
      const j0 = Math.ceil((-vy) / minor), j1 = Math.floor((viewH - vy) / minor);
      for (let j = j0; j <= j1; j++) {
        if (j % 5 === 0) continue;
        const y = Math.floor(vy + j * 10 * vz) + 0.5;
        gctx.moveTo(0, y); gctx.lineTo(viewW, y);
      }
      gctx.stroke();
    }

    const major = 50 * vz;
    if (major >= 4) {
      gctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      gctx.beginPath();
      const i0 = Math.ceil((-vx) / major), i1 = Math.floor((viewW - vx) / major);
      for (let i = i0; i <= i1; i++) {
        const x = Math.floor(vx + i * 50 * vz) + 0.5;
        gctx.moveTo(x, 0); gctx.lineTo(x, viewH);
      }
      const j0 = Math.ceil((-vy) / major), j1 = Math.floor((viewH - vy) / major);
      for (let j = j0; j <= j1; j++) {
        const y = Math.floor(vy + j * 50 * vz) + 0.5;
        gctx.moveTo(0, y); gctx.lineTo(viewW, y);
      }
      gctx.stroke();
    }
  }

  function syncRenderedView() {
    if (drawing) return;
    if (wheelSyncTimer) { clearTimeout(wheelSyncTimer); wheelSyncTimer = 0; }
    if (panRafId) { cancelAnimationFrame(panRafId); panRafId = 0; }
    applyPan();
    renderedView.x = pan.x;
    renderedView.y = pan.y;
    renderedView.z = pan.z;
    layer.style.transform = 'translate3d(0px, 0px, 0px) scale(1)';
    wrap.classList.remove('panning');
    if (textEdit) {
      const sx = pan.x + textEdit.p.x * pan.z, sy = pan.y + textEdit.p.y * pan.z;
      textEdit.input.style.left = (sx - 3) + 'px';
      textEdit.input.style.top = (sy - TEXT_SIZE * 0.625 - 1) + 'px';
    }
    drawPaperGrid();
    renderAllStrokes();
  }
  function scheduleWheelSync() {
    wrap.classList.add('panning');
    if (wheelSyncTimer) clearTimeout(wheelSyncTimer);
    wheelSyncTimer = setTimeout(syncRenderedView, 120);
  }

  // 表示領域内の点 (cx, cy) を中心に拡大縮小
  function zoomCanvasAt(factor, cx, cy, immediate = true) {
    if (textEdit) commitText();
    const nz = clampZoom(pan.z * factor);
    const k = nz / pan.z;
    pan.x = cx - (cx - pan.x) * k;
    pan.y = cy - (cy - pan.y) * k;
    pan.z = nz;
    if (immediate) syncRenderedView();
    else { applyPan(); scheduleWheelSync(); }
  }
  function resetPan() {
    if (textEdit) commitText();
    pan.z = 1;
    pan.x = 0;
    pan.y = 0;
    syncRenderedView();
  }

  // キャンバスサイズ調整（表示領域ぴったりに合わせ、ベクター履歴からくっきり再描画）
  function resizeCanvas() {
    if (drawing) return;
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);
    if (w === viewW && h === viewH) { applyPan(); return; }
    viewW = w; viewH = h;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    for (const c of [paperGrid, canvas, preview]) {
      c.width = W; c.height = H;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    syncRenderedView();
  }
  let resizeQueued = false;
  function requestResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
  }

  // --- 履歴（Undo / Redo）：ベクターストロークを保持 ---
  const undoStack = [];
  let histIndex = 0;
  const MAX_HISTORY = 300;

  function pushHistory(entry) {
    undoStack.length = histIndex;
    undoStack.push(entry);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    histIndex = undoStack.length;
    updateHistoryButtons();
  }
  function hasVisibleStrokes() {
    for (let i = histIndex - 1; i >= 0; i--) {
      return undoStack[i].tool !== 'clear';
    }
    return false;
  }
  function undo() {
    if (drawing || histIndex <= 0) return;
    commitText();
    histIndex--;
    renderAllStrokes();
    updateHistoryButtons();
  }
  function redo() {
    if (drawing || histIndex >= undoStack.length) return;
    commitText();
    histIndex++;
    renderAllStrokes();
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $('undoBtn').disabled = histIndex <= 0;
    const redoBtn = $('redoBtn');
    if (redoBtn) redoBtn.disabled = histIndex >= undoStack.length;
  }

  // ワールド座標の範囲 → 表示領域内のデバイスピクセル矩形
  function worldBoundsToDeviceRect(b, screenPadCss) {
    const sx0 = renderedView.x + b.minX * renderedView.z - screenPadCss;
    const sy0 = renderedView.y + b.minY * renderedView.z - screenPadCss;
    const sx1 = renderedView.x + b.maxX * renderedView.z + screenPadCss;
    const sy1 = renderedView.y + b.maxY * renderedView.z + screenPadCss;
    const x0 = Math.max(0, Math.floor(sx0 * dpr));
    const y0 = Math.max(0, Math.floor(sy0 * dpr));
    const x1 = Math.min(canvas.width, Math.ceil(sx1 * dpr));
    const y1 = Math.min(canvas.height, Math.ceil(sy1 * dpr));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // --- 描画ヘルパー（えんぴつ風テクスチャ・薄めの発色） ---
  const alphaFor = () => state.alpha;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // 色鉛筆・鉛筆らしい自然な発色に整える
  function pencilRgb(hex) {
    let [r, g, b] = hexToRgb(hex);
    const lum = (r + g + b) / 3;
    if (lum >= 245) return [246, 246, 248];
    if (lum > 40) {
      const mix = 0.12;
      r = Math.round(r + (255 - r) * mix);
      g = Math.round(g + (255 - g) * mix);
      b = Math.round(b + (255 - b) * mix);
    }
    return [r, g, b];
  }
  const pencilColorCss = (hex) => {
    const [r, g, b] = pencilRgb(hex);
    return `rgb(${r}, ${g}, ${b})`;
  };

  // 色・半径ごとに「2倍解像度できめ細かい鉛筆の粒子スタンプ」を16種類キャッシュ
  const pencilCache = new Map();
  function getPencilDabs(hex, radius) {
    const key = `${hex}_${radius}_${dpr}`;
    if (pencilCache.has(key)) return pencilCache.get(key);
    const VARIANTS = 16;
    const ss = dpr * 2; // 2倍オーバーサンプリングで粒子をきめ細かくする
    const R = Math.max(2, Math.ceil((radius + 1.0) * ss));
    const S = R * 2;
    const sheet = document.createElement('canvas');
    sheet.width = S * VARIANTS;
    sheet.height = S;
    const sctx = sheet.getContext('2d');
    const img = sctx.createImageData(sheet.width, S);
    const data = img.data;
    const [cr, cg, cb] = pencilRgb(hex);
    let seed = 2463534242;
    const rand = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    const denom = Math.max(0.5, radius * ss);
    for (let v = 0; v < VARIANTS; v++) {
      const ox = v * S;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dx = (x + 0.5 - R) / denom;
          const dy = (y + 0.5 - R) / denom;
          const dist = Math.hypot(dx, dy);
          if (dist > 1.08) continue;
          // 中心は高密度に色が乗り、フチはきめ細かく自然にかすれる鉛筆プロファイル
          const profile = Math.pow(Math.max(0, 1 - dist * dist * 0.85), 1.1);
          const n1 = rand(), n2 = rand();
          if (n1 > profile * 0.80) continue; // 微細な紙の目
          const alpha = Math.min(1, profile * (0.28 + n2 * 0.38));
          const idx = (y * sheet.width + ox + x) * 4;
          data[idx] = cr;
          data[idx + 1] = cg;
          data[idx + 2] = cb;
          data[idx + 3] = Math.round(alpha * 255);
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    const entry = { sheet, S, drawS: S / 2, drawR: R / 2, VARIANTS };
    pencilCache.set(key, entry);
    return entry;
  }

  // 文字用のきめ細かい紙目パターン
  const textPatternCache = new Map();
  function getTextPattern(hex, scaleFactor = 1) {
    let p = textPatternCache.get(hex);
    if (!p) {
      const [cr, cg, cb] = pencilRgb(hex);
      let seed = 135792468;
      const rand = () => {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
      };
      const psz = 96;
      const pcan = document.createElement('canvas');
      pcan.width = psz; pcan.height = psz;
      const patCtx = pcan.getContext('2d');
      const pimg = patCtx.createImageData(psz, psz);
      const pd = pimg.data;
      for (let i = 0; i < psz * psz; i++) {
        const a = rand() < 0.14 ? 0.65 : (0.84 + rand() * 0.16);
        pd[i * 4] = cr; pd[i * 4 + 1] = cg; pd[i * 4 + 2] = cb;
        pd[i * 4 + 3] = Math.round(a * 255);
      }
      patCtx.putImageData(pimg, 0, 0);
      p = ctx.createPattern(pcan, 'repeat');
      textPatternCache.set(hex, p);
    }
    if (p && p.setTransform && typeof DOMMatrix !== 'undefined') {
      const s = 0.5 * Math.min(3, Math.max(0.5, scaleFactor));
      p.setTransform(new DOMMatrix().scale(s, s));
    }
    return p || pencilColorCss(hex);
  }

  // 線の半径に応じたスタンプ間隔（太さを変えても鉛筆の粒状感・濃さが自然になるよう調整）
  const pencilStepFor = (radius) => Math.min(2.0, Math.max(0.5, radius * 0.28));
  function stampDotScaled(c, dabs, dabScale, jitterScale, x, y, idx) {
    const h = ((idx * 2654435761) >>> 0);
    const v = h % dabs.VARIANTS;
    const jx = (((h >>> 8) & 255) / 255 - 0.5) * 0.26 * jitterScale * dpr;
    const jy = (((h >>> 16) & 255) / 255 - 0.5) * 0.26 * jitterScale * dpr;
    const r = dabs.drawR * dabScale;
    const s = dabs.drawS * dabScale;
    c.drawImage(dabs.sheet, v * dabs.S, 0, dabs.S, dabs.S,
      x * dpr + jx - r, y * dpr + jy - r, s, s);
  }
  function stampSegmentScaled(c, dabs, dabScale, step, jitterScale, x1, y1, x2, y2, st, clip) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    let d = st.rem;
    if (clip && (
      (x1 < clip.minX && x2 < clip.minX) || (x1 > clip.maxX && x2 > clip.maxX) ||
      (y1 < clip.minY && y2 < clip.minY) || (y1 > clip.maxY && y2 > clip.maxY)
    )) {
      if (d <= len) {
        const n = Math.floor((len - d) / step) + 1;
        st.idx += n;
        d += n * step;
      }
      st.rem = d - len;
      return;
    }
    const ux = dx / len, uy = dy / len;
    while (d <= len) {
      const px = x1 + ux * d, py = y1 + uy * d;
      const idx = st.idx++;
      if (!clip || (px >= clip.minX && px <= clip.maxX && py >= clip.minY && py <= clip.maxY)) {
        stampDotScaled(c, dabs, dabScale, jitterScale, px, py, idx);
      }
      d += step;
    }
    st.rem = d - len;
  }
  function stampQuadScaled(c, dabs, dabScale, step, quadStep, jitterScale, p0, p1, p2, st, clip) {
    const approx = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.ceil(approx / quadStep));
    let px = p0.x, py = p0.y;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, mt = 1 - t;
      const nx = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
      const ny = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
      stampSegmentScaled(c, dabs, dabScale, step, jitterScale, px, py, nx, ny, st, clip);
      px = nx; py = ny;
    }
  }

  // 楕円（丸）の縁を鉛筆スタンプでなぞる（細かい線分に分割して連続描画）
  function stampEllipse(c, dabs, dabScale, step, jitterScale, cx, cy, rx, ry, st, clip) {
    const n = Math.min(720, Math.max(36, Math.ceil(Math.PI * (rx + ry) / 3)));
    let px = cx + rx, py = cy;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const nx = cx + Math.cos(a) * rx, ny = cy + Math.sin(a) * ry;
      stampSegmentScaled(c, dabs, dabScale, step, jitterScale, px, py, nx, ny, st, clip);
      px = nx; py = ny;
    }
  }

  function computeShapeEndpoints(tool, a, b, shift) {
    let { x: x1, y: y1 } = a, { x: x2, y: y2 } = b;
    if (shift) {
      if (tool === 'line') {
        const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x2 - x1, y2 - y1);
        x2 = x1 + Math.cos(ang) * len; y2 = y1 + Math.sin(ang) * len;
      } else {
        const dd = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        x2 = x1 + Math.sign(x2 - x1 || 1) * dd; y2 = y1 + Math.sign(y2 - y1 || 1) * dd;
      }
    }
    return { x1, y1, x2, y2 };
  }

  const FONT_FAMILY = '"Segoe UI", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif';
  const TEXT_SIZE = 24; // 描画時の画面上での文字サイズ（px）
  const TEXT_FONT = `${TEXT_SIZE}px ${FONT_FAMILY}`;

  // 保存済みストロークを現在の表示領域(renderedView)へくっきり描画
  function renderStrokeToViewport(s) {
    const vx = renderedView.x, vy = renderedView.y, vz = renderedView.z;
    const wLeft = -vx / vz, wTop = -vy / vz;
    const wRight = (viewW - vx) / vz, wBottom = (viewH - vy) / vz;
    const pad = (s.worldSize || s.worldFontSize || 0) + 6 / vz;
    if (s.bounds.maxX + pad < wLeft || s.bounds.minX - pad > wRight ||
        s.bounds.maxY + pad < wTop || s.bounds.minY - pad > wBottom) return;

    if (s.tool === 'fill') {
      // 図形(四角・丸)の内側を塗りつぶし（枠線の内側ぶん縮めて枠線は残す）
      const sx1 = vx + s.x1 * vz, sy1 = vy + s.y1 * vz;
      const sx2 = vx + s.x2 * vz, sy2 = vy + s.y2 * vz;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = getTextPattern(s.color, 1);
      ctx.beginPath();
      if (s.kind === 'circle') {
        ctx.ellipse((sx1 + sx2) / 2, (sy1 + sy2) / 2, Math.abs(sx2 - sx1) / 2, Math.abs(sy2 - sy1) / 2, 0, 0, Math.PI * 2);
      } else {
        ctx.rect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
      }
      ctx.fill();
      ctx.restore();
      return;
    }
    if (s.tool === 'floodfill') {
      // 領域塗り：作成時に得たビットマップをワールド座標に貼り付け（拡大縮小・移動に追従）
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = s.alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(s.bmp, (vx + s.wx * vz) * dpr, (vy + s.wy * vz) * dpr, s.ww * vz * dpr, s.wh * vz * dpr);
      ctx.restore();
      return;
    }
    if (s.tool === 'text') {
      const scaleFactor = vz / s.baseZ;
      const fs = s.worldFontSize * vz;
      if (fs < 1.2) return;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = getTextPattern(s.color, scaleFactor);
      ctx.font = `${fs}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, vx + s.p.x * vz, vy + s.p.y * vz);
      ctx.restore();
      return;
    }

    const scaleFactor = vz / s.baseZ;
    const screenR = (s.worldSize / 2) * vz;

    // 大きく縮小して極細になった線は軽量なアンチエイリアスパスで描画
    if (screenR < 0.6) {
      const w = screenR * 2;
      const drawW = Math.max(0.7, w);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = pencilColorCss(s.color);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = drawW;
      ctx.globalAlpha = s.alpha * 0.72 * (w < 0.7 ? Math.max(0.3, w / 0.7) : 1);
      if (s.tool === 'pen') {
        const pts = s.pts;
        if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(vx + pts[0].x * vz, vy + pts[0].y * vz, drawW / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(vx + pts[0].x * vz, vy + pts[0].y * vz);
          for (let i = 1; i < pts.length; i++) {
            const prev = pts[i - 1], cur = pts[i];
            ctx.quadraticCurveTo(
              vx + prev.x * vz, vy + prev.y * vz,
              vx + (prev.x + cur.x) * 0.5 * vz, vy + (prev.y + cur.y) * 0.5 * vz
            );
          }
          const last = pts[pts.length - 1];
          ctx.lineTo(vx + last.x * vz, vy + last.y * vz);
          ctx.stroke();
        }
      } else {
        const sx1 = vx + s.x1 * vz, sy1 = vy + s.y1 * vz;
        const sx2 = vx + s.x2 * vz, sy2 = vy + s.y2 * vz;
        ctx.beginPath();
        if (Math.hypot(sx2 - sx1, sy2 - sy1) < 0.5) {
          ctx.arc(sx1, sy1, drawW / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (s.tool === 'line') {
          ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
        } else {
          if (s.tool === 'circle') {
            ctx.ellipse((sx1 + sx2) / 2, (sy1 + sy2) / 2, Math.abs(sx2 - sx1) / 2, Math.abs(sy2 - sy1) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.strokeRect(Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
          }
        }
      }
      ctx.restore();
      return;
    }

    const dabR = Math.min(18, Math.max(0.6, Math.round(screenR * 4) / 4));
    const dabs = getPencilDabs(s.color, dabR);
    const dabScale = screenR / dabR;
    const baseR = (s.worldSize * s.baseZ) / 2;
    const step = pencilStepFor(baseR) * scaleFactor;
    const quadStep = Math.min(8, 1.5 * scaleFactor);
    const margin = screenR + 6;
    const clip = { minX: -margin, minY: -margin, maxX: viewW + margin, maxY: viewH + margin };
    const rect = worldBoundsToDeviceRect(s.bounds, margin);
    if (!rect) return;

    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';

    if (s.tool === 'pen') {
      const pts = s.pts;
      const st = { rem: 0, idx: 1 };
      const p0 = { x: vx + pts[0].x * vz, y: vy + pts[0].y * vz };
      for (let k = 0; k < 3; k++) {
        const idx = st.idx++;
        if (p0.x >= clip.minX && p0.x <= clip.maxX && p0.y >= clip.minY && p0.y <= clip.maxY) {
          stampDotScaled(pctx, dabs, dabScale, scaleFactor, p0.x, p0.y, idx);
        }
      }
      st.rem = step;
      let mid = p0;
      for (let i = 1; i < pts.length; i++) {
        const prevW = pts[i - 1], curW = pts[i];
        const prev = { x: vx + prevW.x * vz, y: vy + prevW.y * vz };
        const nextMid = { x: vx + (prevW.x + curW.x) * 0.5 * vz, y: vy + (prevW.y + curW.y) * 0.5 * vz };
        stampQuadScaled(pctx, dabs, dabScale, step, quadStep, scaleFactor, mid, prev, nextMid, st, clip);
        mid = nextMid;
      }
      const lastW = pts[pts.length - 1];
      stampSegmentScaled(pctx, dabs, dabScale, step, scaleFactor, mid.x, mid.y, vx + lastW.x * vz, vy + lastW.y * vz, st, clip);
    } else {
      const sx1 = vx + s.x1 * vz, sy1 = vy + s.y1 * vz;
      const sx2 = vx + s.x2 * vz, sy2 = vy + s.y2 * vz;
      const st = { rem: 0, idx: 1 };
      if (Math.hypot(sx2 - sx1, sy2 - sy1) < 0.5 * scaleFactor) {
        for (let k = 0; k < 3; k++) {
          const idx = st.idx++;
          if (sx1 >= clip.minX && sx1 <= clip.maxX && sy1 >= clip.minY && sy1 <= clip.maxY) {
            stampDotScaled(pctx, dabs, dabScale, scaleFactor, sx1, sy1, idx);
          }
        }
      } else if (s.tool === 'line') {
        stampSegmentScaled(pctx, dabs, dabScale, step, scaleFactor, sx1, sy1, sx2, sy2, st, clip);
      } else if (s.tool === 'circle') {
        stampEllipse(pctx, dabs, dabScale, step, scaleFactor, (sx1 + sx2) / 2, (sy1 + sy2) / 2,
          Math.abs(sx2 - sx1) / 2, Math.abs(sy2 - sy1) / 2, st, clip);
      } else if (s.tool === 'rect') {
        const rx0 = Math.min(sx1, sx2), ry0 = Math.min(sy1, sy2);
        const rx1 = Math.max(sx1, sx2), ry1 = Math.max(sy1, sy2);
        stampSegmentScaled(pctx, dabs, dabScale, step, scaleFactor, rx0, ry0, rx1, ry0, st, clip);
        st.rem = 0; stampSegmentScaled(pctx, dabs, dabScale, step, scaleFactor, rx1, ry0, rx1, ry1, st, clip);
        st.rem = 0; stampSegmentScaled(pctx, dabs, dabScale, step, scaleFactor, rx1, ry1, rx0, ry1, st, clip);
        st.rem = 0; stampSegmentScaled(pctx, dabs, dabScale, step, scaleFactor, rx0, ry1, rx0, ry0, st, clip);
      }
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(preview, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    pctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  }

  function renderAllStrokes() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!viewW || !viewH || histIndex <= 0) return;
    let startIdx = 0;
    for (let i = histIndex - 1; i >= 0; i--) {
      if (undoStack[i].tool === 'clear') { startIdx = i + 1; break; }
    }
    for (let i = startIdx; i < histIndex; i++) {
      renderStrokeToViewport(undoStack[i]);
    }
  }

  // --- ライブ描画（現在描いている途中の線：常に画面上の太さ state.size でくっきり描く） ---
  const toScreen = (wp) => ({ x: renderedView.x + wp.x * renderedView.z, y: renderedView.y + wp.y * renderedView.z });

  function renderFreehand(d, final) {
    const pts = d.pts;
    const r = d.size / 2;
    const step = pencilStepFor(r);
    const dabs = getPencilDabs(d.color, r);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';
    if (d.drawn === 0) {
      d.pencil = { rem: 0, idx: 1 };
      const s0 = toScreen(pts[0]);
      for (let k = 0; k < 3; k++) stampDotScaled(pctx, dabs, 1, 1, s0.x, s0.y, d.pencil.idx++);
      d.pencil.rem = step;
      d.mid = s0;
      d.drawn = 1;
    }
    if (pts.length > d.drawn || final) {
      for (let i = d.drawn; i < pts.length; i++) {
        const prev = toScreen(pts[i - 1]), cur = toScreen(pts[i]);
        const mid = { x: (prev.x + cur.x) * 0.5, y: (prev.y + cur.y) * 0.5 };
        stampQuadScaled(pctx, dabs, 1, step, 1.5, 1, d.mid, prev, mid, d.pencil, null);
        d.mid = mid;
      }
      if (final) {
        const last = toScreen(pts[pts.length - 1]);
        stampSegmentScaled(pctx, dabs, 1, step, 1, d.mid.x, d.mid.y, last.x, last.y, d.pencil, null);
      }
      d.drawn = pts.length;
    }
  }

  function renderShape(d) {
    if (d.shapeRect) {
      const r0 = d.shapeRect;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(r0.x, r0.y, r0.w, r0.h);
    }
    const ep = computeShapeEndpoints(d.tool, d.start, d.last, d.shift);
    d.ep = ep;
    d.bounds = {
      minX: Math.min(ep.x1, ep.x2), minY: Math.min(ep.y1, ep.y2),
      maxX: Math.max(ep.x1, ep.x2), maxY: Math.max(ep.y1, ep.y2),
    };
    const sx1 = renderedView.x + ep.x1 * renderedView.z, sy1 = renderedView.y + ep.y1 * renderedView.z;
    const sx2 = renderedView.x + ep.x2 * renderedView.z, sy2 = renderedView.y + ep.y2 * renderedView.z;
    const r = d.size / 2;
    const step = pencilStepFor(r);
    const dabs = getPencilDabs(d.color, r);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';
    const st = { rem: 0, idx: 1 };
    if (Math.hypot(sx2 - sx1, sy2 - sy1) < 0.5) {
      for (let k = 0; k < 3; k++) stampDotScaled(pctx, dabs, 1, 1, sx1, sy1, st.idx++);
    } else if (d.tool === 'line') {
      stampSegmentScaled(pctx, dabs, 1, step, 1, sx1, sy1, sx2, sy2, st, null);
    } else if (d.tool === 'circle') {
      stampEllipse(pctx, dabs, 1, step, 1, (sx1 + sx2) / 2, (sy1 + sy2) / 2,
        Math.abs(sx2 - sx1) / 2, Math.abs(sy2 - sy1) / 2, st, null);
    } else if (d.tool === 'rect') {
      const rx0 = Math.min(sx1, sx2), ry0 = Math.min(sy1, sy2);
      const rx1 = Math.max(sx1, sx2), ry1 = Math.max(sy1, sy2);
      stampSegmentScaled(pctx, dabs, 1, step, 1, rx0, ry0, rx1, ry0, st, null);
      st.rem = 0; stampSegmentScaled(pctx, dabs, 1, step, 1, rx1, ry0, rx1, ry1, st, null);
      st.rem = 0; stampSegmentScaled(pctx, dabs, 1, step, 1, rx1, ry1, rx0, ry1, st, null);
      st.rem = 0; stampSegmentScaled(pctx, dabs, 1, step, 1, rx0, ry1, rx0, ry0, st, null);
    }
    d.shapeRect = worldBoundsToDeviceRect(d.bounds, r + 6);
  }

  // --- ポインター操作 ---
  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!drawing) return;
      if (drawing.tool === 'pen') renderFreehand(drawing, false);
      else renderShape(drawing);
    });
  }

  // 画面座標 → ワールド座標（下段の移動量・拡大率を考慮）
  const getWorldPos = (e, r) => ({
    x: (e.clientX - r.left - pan.x) / pan.z,
    y: (e.clientY - r.top - pan.y) / pan.z,
  });
  function expand(b, p) {
    if (p.x < b.minX) b.minX = p.x; if (p.x > b.maxX) b.maxX = p.x;
    if (p.y < b.minY) b.minY = p.y; if (p.y > b.maxY) b.maxY = p.y;
  }

  // --- スワイプ移動：✋ツール / 2本指 / スペース+ドラッグ / マウス中ボタン・右ボタン ---
  const panPointers = new Map(); // pointerId -> {x, y}（画面座標）
  let panGesture = null;
  let spaceDown = false;
  let pendingTap = null;    // 文字ツール（指を離すまで保留）
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
  let canvasPanSpeed = PAN_SPEED;
  const TWO_FINGER_PAN_SPEED = 1.0;
  function startPan() {
    if (textEdit) commitText();
    if (panRafId) { cancelAnimationFrame(panRafId); panRafId = 0; applyPan(); }
    wrap.classList.add('panning');
    const c = panCenter();
    const multi = panPointers.size >= 2;
    panGesture = {
      sx: c.x, sy: c.y, px: pan.x, py: pan.y, z: pan.z,
      r: wrap.getBoundingClientRect(),
      dist: multi ? pointerDist() : 0,
      speed: multi ? TWO_FINGER_PAN_SPEED : canvasPanSpeed,
    };
    wrap.style.cursor = 'grabbing';
  }
  function endCanvasPan(e) {
    if (!panPointers.delete(e.pointerId)) return false;
    if (panPointers.size) startPan();
    else {
      panGesture = null;
      updateCursor();
      syncRenderedView();
    }
    return true;
  }
  // 描き始めの線を取り消す（2本指スワイプに切り替える時）
  function cancelDrawing() {
    if (!drawing) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, preview.width, preview.height);
    preview.style.opacity = 1;
    drawing = null;
  }

  // --- 文字ツール：タップした場所に入力欄を出し、確定したらキャンバスに描く ---
  const measureCtx = document.createElement('canvas').getContext('2d');
  let textEdit = null;
  function openText(p) {
    commitText();
    if (renderedView.x !== pan.x || renderedView.y !== pan.y || renderedView.z !== pan.z) {
      syncRenderedView();
    }
    const sx = pan.x + p.x * pan.z, sy = pan.y + p.y * pan.z;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'textInput';
    input.autocomplete = 'off';
    input.enterKeyHint = 'done';
    input.style.fontSize = TEXT_SIZE + 'px';
    input.style.color = pencilColorCss(state.color);
    input.style.opacity = String(Math.min(1, state.alpha + 0.1));
    input.style.left = (sx - 3) + 'px';
    input.style.top = (sy - TEXT_SIZE * 0.625 - 1) + 'px';
    const fit = () => {
      measureCtx.font = TEXT_FONT;
      input.style.width = Math.ceil(measureCtx.measureText(input.value || 'あ').width + TEXT_SIZE * 0.6) + 'px';
    };
    fit();
    input.addEventListener('input', fit);
    input.addEventListener('keydown', (ev) => {
      if (ev.isComposing) return;
      if (ev.key === 'Enter') { ev.preventDefault(); commitText(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commitText(true); }
    });
    input.addEventListener('blur', () => {
      if (textEdit && textEdit.input === input && performance.now() - textEdit.opened < 400) input.focus({ preventScroll: true });
      else commitText();
    });
    layer.appendChild(input);
    textEdit = { input, p, color: state.color, alpha: state.alpha, baseZ: pan.z, opened: performance.now() };
    input.focus({ preventScroll: true });
  }
  function commitText(cancel) {
    const t = textEdit;
    if (!t) return;
    textEdit = null;
    const text = t.input.value;
    t.input.remove();
    if (cancel || !text.trim()) return;
    measureCtx.font = TEXT_FONT;
    const screenW = measureCtx.measureText(text).width;
    const worldFontSize = TEXT_SIZE / t.baseZ;
    const worldW = screenW / t.baseZ;
    const entry = {
      tool: 'text',
      p: t.p,
      text,
      color: t.color,
      alpha: t.alpha,
      worldFontSize,
      baseZ: t.baseZ,
      bounds: {
        minX: t.p.x, maxX: t.p.x + worldW,
        minY: t.p.y - worldFontSize * 0.75, maxY: t.p.y + worldFontSize * 0.75,
      },
    };
    renderStrokeToViewport(entry);
    pushHistory(entry);
  }

  // --- 塗りつぶしツール：四角・丸をタップ→その図形を塗る／なければ囲まれた空白を領域塗り ---
  function shapeContains(s, p) {
    const x0 = Math.min(s.x1, s.x2), x1 = Math.max(s.x1, s.x2);
    const y0 = Math.min(s.y1, s.y2), y1 = Math.max(s.y1, s.y2);
    if (s.tool === 'rect') return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (p.x - (x0 + x1) / 2) / rx, dy = (p.y - (y0 + y1) / 2) / ry;
    return dx * dx + dy * dy <= 1;
  }
  function fillAt(p) {
    commitText();
    syncRenderedView();
    let start = 0;
    for (let i = histIndex - 1; i >= 0; i--) {
      if (undoStack[i].tool === 'clear') { start = i + 1; break; }
    }
    for (let i = histIndex - 1; i >= start; i--) {
      const s = undoStack[i];
      if ((s.tool !== 'rect' && s.tool !== 'circle') || !shapeContains(s, p)) continue;
      const h = s.worldSize / 2; // 枠線の内側から塗る
      const x0 = Math.min(s.x1, s.x2) + h, x1 = Math.max(s.x1, s.x2) - h;
      const y0 = Math.min(s.y1, s.y2) + h, y1 = Math.max(s.y1, s.y2) - h;
      if (x1 <= x0 || y1 <= y0) return;
      const entry = {
        tool: 'fill', kind: s.tool, x1: x0, y1: y0, x2: x1, y2: y1,
        color: state.color, alpha: state.alpha, worldSize: 0,
        bounds: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
      };
      renderStrokeToViewport(entry);
      pushHistory(entry);
      return;
    }
    floodFillAt(p);
  }
  function floodFillAt(p) {
    const vx = renderedView.x, vy = renderedView.y, vz = renderedView.z;
    const W = canvas.width, H = canvas.height;
    const sx = Math.floor((vx + p.x * vz) * dpr), sy = Math.floor((vy + p.y * vz) * dpr);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const d = ctx.getImageData(0, 0, W, H).data;
    const si = (sy * W + sx) * 4;
    const r0 = d[si], g0 = d[si + 1], b0 = d[si + 2], a0 = d[si + 3];
    const blank = a0 < 24;
    const same = (i) => blank
      ? d[i + 3] < 48
      : Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) + Math.abs(d[i + 3] - a0) <= 64;
    const mask = new Uint8Array(W * H);
    const stack = [sx, sy];
    let minX = sx, maxX = sx, minY = sy, maxY = sy;
    while (stack.length) {
      const y = stack.pop(), x0 = stack.pop();
      let x = x0;
      while (x >= 0 && !mask[y * W + x] && same((y * W + x) * 4)) x--;
      x++;
      let up = false, down = false;
      for (; x < W && !mask[y * W + x] && same((y * W + x) * 4); x++) {
        mask[y * W + x] = 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (y > 0) {
          const ok = !mask[(y - 1) * W + x] && same(((y - 1) * W + x) * 4);
          if (ok && !up) { stack.push(x, y - 1); up = true; } else if (!ok) up = false;
        }
        if (y < H - 1) {
          const ok = !mask[(y + 1) * W + x] && same(((y + 1) * W + x) * 4);
          if (ok && !down) { stack.push(x, y + 1); down = true; } else if (!ok) down = false;
        }
      }
    }
    // 1px広げて、線のフチのすき間（アンチエイリアス部分）まで塗る
    const bx0 = Math.max(0, minX - 1), by0 = Math.max(0, minY - 1);
    const bx1 = Math.min(W - 1, maxX + 1), by1 = Math.min(H - 1, maxY + 1);
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const [cr, cg, cb] = pencilRgb(state.color);
    const out = new ImageData(bw, bh);
    const od = out.data;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        let on = mask[y * W + x];
        if (!on) {
          on = (x > 0 && mask[y * W + x - 1]) || (x < W - 1 && mask[y * W + x + 1]) ||
               (y > 0 && mask[(y - 1) * W + x]) || (y < H - 1 && mask[(y + 1) * W + x]);
        }
        if (on) {
          const o = ((y - by0) * bw + (x - bx0)) * 4;
          od[o] = cr; od[o + 1] = cg; od[o + 2] = cb; od[o + 3] = 255;
        }
      }
    }
    const bmp = document.createElement('canvas');
    bmp.width = bw; bmp.height = bh;
    bmp.getContext('2d').putImageData(out, 0, 0);
    const wx = (bx0 / dpr - vx) / vz, wy = (by0 / dpr - vy) / vz;
    const ww = bw / dpr / vz, wh = bh / dpr / vz;
    const entry = {
      tool: 'floodfill', bmp, wx, wy, ww, wh, color: state.color, alpha: state.alpha, worldSize: 0,
      bounds: { minX: wx, minY: wy, maxX: wx + ww, maxY: wy + wh },
    };
    renderStrokeToViewport(entry);
    pushHistory(entry);
  }

  const captureWrap = (id) => { try { wrap.setPointerCapture(id); } catch (_) {} };

  wrap.addEventListener('pointerdown', (e) => {
    if (textEdit && e.target === textEdit.input) return;
    const isMouse = e.pointerType === 'mouse';
    const isTouch = e.pointerType === 'touch';
    if (isMouse && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    const mousePan = isMouse && (e.button === 1 || e.button === 2);
    const firstTouch = drawing && drawing.pointerType === 'touch' ? drawing : pendingTap;
    const twoFinger = isTouch && !!firstTouch;
    if (panGesture || twoFinger || state.tool === 'hand' || spaceDown || mousePan) {
      e.preventDefault();
      captureWrap(e.pointerId);
      canvasPanSpeed = 1.0; // 指・マウスとも1:1で追従（0.5倍だと鈍く感じるため）
      if (twoFinger) {
        panPointers.set(firstTouch.id, firstTouch.client);
        if (pendingTap) pendingTap = null;
        else if (performance.now() - drawing.t0 < 300) cancelDrawing();
        else finishDrawing();
      }
      panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (panPointers.size === 1 && isTouch && state.tool === 'hand') {
        const now = performance.now();
        if (now - lastCanvasTap < 300) { resetPan(); lastCanvasTap = 0; } else lastCanvasTap = now;
      }
      startPan();
      return;
    }
    if (isMouse && e.button !== 0) return;
    if (drawing || pendingTap) return;
    e.preventDefault();
    if (textEdit) { commitText(); return; }
    if (renderedView.x !== pan.x || renderedView.y !== pan.y || renderedView.z !== pan.z) {
      syncRenderedView();
    }
    const rect = wrap.getBoundingClientRect();
    const p = getWorldPos(e, rect);
    const tool = state.tool;

    if (tool === 'text' || tool === 'fill') {
      captureWrap(e.pointerId);
      pendingTap = { id: e.pointerId, p, tool, client: { x: e.clientX, y: e.clientY }, start: { x: e.clientX, y: e.clientY } };
      return;
    }
    captureWrap(e.pointerId);
    const snap = e.shiftKey || state.snap;
    const mp = applyMagnet(p, tool, pan.z);
    drawing = {
      id: e.pointerId, tool, rect, pts: [mp], start: mp, last: mp, ep: null, shift: snap,
      color: state.color, size: state.size, alpha: alphaFor(), baseZ: pan.z,
      drawn: 0, mid: null, bounds: { minX: mp.x, minY: mp.y, maxX: mp.x, maxY: mp.y }, shapeRect: null,
      pointerType: e.pointerType, t0: performance.now(), client: { x: e.clientX, y: e.clientY },
    };
    preview.style.opacity = drawing.alpha;
    if (tool === 'pen') renderFreehand(drawing, false);
  });

  wrap.addEventListener('pointermove', (e) => {
    if (panPointers.has(e.pointerId)) {
      panPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = panGesture;
      const c = panCenter();
      let z = g.z;
      if (g.dist && panPointers.size >= 2) z = g.z * pointerDist() / g.dist;
      z = clampZoom(z);
      const sx = g.sx - g.r.left, sy = g.sy - g.r.top;
      const lx = (sx - g.px) / g.z, ly = (sy - g.py) / g.z;
      pan.z = z;
      pan.x = sx + (c.x - g.sx) * g.speed - lx * z;
      pan.y = sy + (c.y - g.sy) * g.speed - ly * z;
      schedulePan();
      return;
    }
    if (pendingTap && e.pointerId === pendingTap.id) {
      pendingTap.client = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!drawing || e.pointerId !== drawing.id) return;
    const d = drawing;
    d.client = { x: e.clientX, y: e.clientY };
    if (d.tool === 'pen') {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const minDelta = 0.4 / d.baseZ; // 拡大率に合わせて画面上0.4px未満の細かすぎる点だけ間引く
      for (const ev of events) {
        const p = getWorldPos(ev, d.rect);
        const last = d.pts[d.pts.length - 1];
        if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < minDelta) continue;
        d.pts.push(p);
        expand(d.bounds, p);
      }
    } else {
      d.last = applyMagnet(getWorldPos(e, d.rect), d.tool, d.baseZ);
      d.shift = e.shiftKey || state.snap;
    }
    scheduleRender();
  });

  function endDraw(e) {
    if (endCanvasPan(e)) return;
    if (pendingTap && e.pointerId === pendingTap.id) {
      const f = pendingTap;
      pendingTap = null;
      const moved = Math.hypot(f.client.x - f.start.x, f.client.y - f.start.y);
      if (e.type === 'pointerup' && moved < 10) {
        if (f.tool === 'fill') fillAt(f.p);
        else openText(f.p);
      }
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
    if (d.tool === 'pen') {
      renderFreehand(d, true);
      rect = worldBoundsToDeviceRect(d.bounds, d.size / 2 + 6);
    } else {
      renderShape(d);
      rect = d.shapeRect;
    }
    if (rect) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = d.alpha;
      ctx.drawImage(preview, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    }
    preview.style.opacity = 1;
    drawing = null;

    const worldSize = d.size / d.baseZ;
    if (d.tool === 'pen') {
      pushHistory({
        tool: 'pen', pts: d.pts, color: d.color, alpha: d.alpha,
        worldSize, baseZ: d.baseZ, bounds: d.bounds,
      });
    } else {
      const ep = d.ep || computeShapeEndpoints(d.tool, d.start, d.last, d.shift);
      pushHistory({
        tool: d.tool, x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2,
        color: d.color, alpha: d.alpha, worldSize, baseZ: d.baseZ, bounds: d.bounds,
      });
    }
  }
  wrap.addEventListener('pointerup', endDraw);
  wrap.addEventListener('pointercancel', endDraw);
  // iOS Safariのピンチによるページ全体ズームを抑止
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

  // --- ツールバー ---
  const toolButtons = document.querySelectorAll('#toolGroup .tool');
  function updateCursor() {
    if (panGesture) return;
    wrap.style.cursor = state.tool === 'hand' || spaceDown ? 'grab' : state.tool === 'text' ? 'text' : state.tool === 'fill' ? 'pointer' : 'crosshair';
  }
  function setTool(t) {
    commitText();
    state.tool = t;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    updateCursor();
  }
  toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  wrap.addEventListener('dblclick', () => { if (state.tool === 'hand') resetPan(); });
  // 下段もホイールで拡大縮小（PC）
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (drawing) return;
    if (textEdit) commitText();
    const r = wrap.getBoundingClientRect();
    if (!e.ctrlKey && isTouchpadWheel(e)) {
      pan.x -= e.deltaX * TOUCHPAD_PAN_SPEED;
      pan.y -= e.deltaY * TOUCHPAD_PAN_SPEED;
      applyPan();
      scheduleWheelSync();
      return;
    }
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    dy = Math.max(-100, Math.min(100, dy));
    const speed = e.ctrlKey ? PINCH_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    zoomCanvasAt(Math.exp(-dy * speed), e.clientX - r.left, e.clientY - r.top, false);
  }, { passive: false });
  if (canvasZoomLabel) canvasZoomLabel.onclick = resetPan;
  // 下段の拡大・縮小ボタン（－ / ＋）：表示領域の中心を基準にズーム
  const zoomCanvasCenter = (f) => zoomCanvasAt(f, (viewW || wrap.clientWidth) / 2, (viewH || wrap.clientHeight) / 2, true);
  $('canvasZoomOutBtn').onclick = () => { commitText(); zoomCanvasCenter(0.8); };
  $('canvasZoomInBtn').onclick = () => { commitText(); zoomCanvasCenter(1.25); };

  // --- 線の太さ調整（－ / ＋ ボタン） ---
  const STROKE_SIZES = [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 30];
  const sizeDownBtn = $('sizeDownBtn');
  const sizeUpBtn = $('sizeUpBtn');
  const sizeIndicator = $('sizeIndicator');
  const sizeDot = $('sizeDot');
  const sizeVal = $('sizeVal');
  let sizeHideTimer = 0;

  function syncSizeUI(flash = false) {
    const idx = STROKE_SIZES.indexOf(state.size);
    if (sizeDownBtn) sizeDownBtn.disabled = idx <= 0;
    if (sizeUpBtn) sizeUpBtn.disabled = idx >= STROKE_SIZES.length - 1;
    if (sizeVal) sizeVal.textContent = `${state.size}px`;
    if (sizeDot) {
      const d = Math.min(16, Math.max(3, state.size));
      sizeDot.style.width = `${d}px`;
      sizeDot.style.height = `${d}px`;
      sizeDot.style.background = state.color;
    }
    if (flash && sizeIndicator) {
      sizeIndicator.classList.add('visible');
      if (sizeHideTimer) clearTimeout(sizeHideTimer);
      sizeHideTimer = setTimeout(() => sizeIndicator.classList.remove('visible'), 1200);
    }
  }
  function stepStrokeSize(dir) {
    let idx = STROKE_SIZES.findIndex((v) => v >= state.size);
    if (idx === -1) idx = STROKE_SIZES.length - 1;
    const nextIdx = Math.min(STROKE_SIZES.length - 1, Math.max(0, idx + dir));
    state.size = STROKE_SIZES[nextIdx];
    syncSizeUI(true);
  }
  if (sizeDownBtn) sizeDownBtn.onclick = () => stepStrokeSize(-1);
  if (sizeUpBtn) sizeUpBtn.onclick = () => stepStrokeSize(1);

  // 並び：赤、緑、青、紫、オレンジ、黄色、白、黒
  const PALETTE = ['#ff4d4f', '#2ecc71', '#3498db', '#9b59b6', '#e67e22', '#f1c40f', '#ffffff', '#1e1e1e'];
  const paletteEl = $('palette');
  function selectColor(c) {
    state.color = c;
    paletteEl.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('selected', s.dataset.color === c));
    if (sizeDot) sizeDot.style.background = c;
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
  syncSizeUI(false);

  // 下段の方眼グリッド表示切替
  const paperGridBtn = $('paperGridBtn');
  if (paperGridBtn) {
    paperGridBtn.onclick = () => {
      state.showPaperGrid = !state.showPaperGrid;
      paperGridBtn.classList.toggle('active', state.showPaperGrid);
      wrap.classList.toggle('hide-grid', !state.showPaperGrid);
      drawPaperGrid();
    };
  }

  $('undoBtn').onclick = undo;
  if ($('redoBtn')) $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => {
    commitText();
    if (!hasVisibleStrokes()) return;
    if (!confirm('描いた内容をすべて消去しますか？')) return;
    pushHistory({ tool: 'clear' });
    renderAllStrokes();
  };

  function save() {
    commitText();
    syncRenderedView();
    // 表示領域ぶん（スワイプ・拡大した見た目のまま）を黒背景で書き出し
    const w = canvas.width, h = canvas.height;
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

  // --- お手本の重ね表示＆透過率調整（上と同じ画角で薄く表示。保存には含まれない） ---
  const overlayBtn = $('overlayBtn');
  const opacityBtn = $('opacityBtn');
  const opacityLabel = $('opacityLabel');
  let overlayAlpha = 40; // 初期値 40%（押すたびに10%刻みで下がり、10%の次は100%へループ）

  function setOverlayAlpha(val) {
    overlayAlpha = val;
    overlayImage.style.opacity = overlayAlpha / 100;
    if (opacityLabel) opacityLabel.textContent = `透過 ${overlayAlpha}%`;
  }

  function toggleOverlay(force) {
    const on = document.body.classList.toggle('show-overlay', force);
    overlayBtn.classList.toggle('active', on);
    if (opacityBtn) opacityBtn.disabled = !on;
    if (on) syncOverlay(); // 重ねた時点の上段の画角に合わせる（以降は上段と連動しない）
  }

  overlayBtn.onclick = () => toggleOverlay();
  if (opacityBtn) {
    opacityBtn.onclick = () => {
      const next = overlayAlpha <= 10 ? 100 : overlayAlpha - 10;
      setOverlayAlpha(next);
    };
  }
  setOverlayAlpha(overlayAlpha);

  /* ---------------------------------------------------------
   * 3. グリッド・仕切り・ショートカット
   * ------------------------------------------------------- */
  const gridToggle = $('gridToggle');
  const gridSize = $('gridSize');
  const updateGrid = () => {
    document.querySelectorAll('.grid-overlay').forEach((g) => g.style.setProperty('--g', gridSize.value + 'px'));
  };
  gridToggle.onchange = (e) => document.body.classList.toggle('show-grid', e.target.checked);
  document.body.classList.toggle('show-grid', gridToggle.checked);
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
    const map = { p: 'pen', l: 'line', r: 'rect', c: 'circle', f: 'fill', a: 'text', h: 'hand' };
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
