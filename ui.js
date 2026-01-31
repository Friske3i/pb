(function () {
  const BOARD_SIZE = window.Game.BOARD_SIZE;
  let state = null;
  let destroyMode = false;
  let searchQuery = '';
  let dependencyHighlightId = null;
  let lastScrollTop = 0;
  let isMouseDown = false;
  let lastProcessedCell = null; // 最後に処理したセルを記録

  function init() {
    window.Game.loadConfig()
      .then(function (config) {
        state = window.Game.createGameState(config);
        destroyMode = false;
        // 初期状態を履歴に保存
        window.Game.saveInitialState(state);
        renderAll();
        bindEvents();
      })
      .catch(function (err) {
        document.body.innerHTML = '<div class="app"><p style="color:#f7768e">設定の読み込みに失敗しました。config.json を配置し、HTTP サーバー経由で開いてください。</p><pre>' + (err && err.message) + '</pre></div>';
      });
  }

  function renderAll() {
    renderScoreParamSelector();
    renderScore();
    renderSpawnHint();
    renderCardList();
    renderBoard();
    updateDestroyButton();
    updateHistoryButtons();
    renderMutationStats();
  }

  function renderScoreParamSelector() {
    const selector = document.getElementById('scoreParamSelector');
    const { index: currentIndex } = window.Game.getScoreParam(state);

    // 初回のみオプションを生成
    if (selector.options.length === 0) {
      const paramNames = state.scoreParamNames || {};
      state.scoreParams.forEach((param, i) => {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = paramNames[param] || param;
        selector.appendChild(option);
      });
    }

    selector.value = currentIndex;
  }

  function renderScore() {
    const score = window.Game.calculateScore(state);
    document.getElementById('scoreValue').textContent = score;
  }

  function renderSpawnHint() {
    const el = document.getElementById('spawnConditionHint');
    if (el) el.textContent = '各カードごとの出現条件を満たす空地に、そのカードが出現します（点数あり）。';
  }

  function renderCardList() {
    const list = document.getElementById('cardList');
    const types = window.Game.getCardTypes(state);
    const { index: scoreParamIndex } = window.Game.getScoreParam(state);

    // スコア順にソート（降順）
    // スコア順にソート（降順）
    // 依存関係ハイライト時は、必要なカードを優先
    let requiredIds = [];
    if (dependencyHighlightId !== null) {
      const targetCard = types.find(c => c.id === dependencyHighlightId);
      if (targetCard && targetCard.conditions) {
        requiredIds = targetCard.conditions.map(c => c.id);
      }
    }

    const sortedTypes = types.slice().sort((a, b) => {
      // ハイライト時は必要なカードを最上位に
      if (dependencyHighlightId !== null) {
        // 右クリックされた本人を一番上に
        if (a.id === dependencyHighlightId) return -1;
        if (b.id === dependencyHighlightId) return 1;

        // 次に必要なカード
        const aReq = requiredIds.includes(a.id);
        const bReq = requiredIds.includes(b.id);
        if (aReq && !bReq) return -1;
        if (!aReq && bReq) return 1;
      }
      return b.params[scoreParamIndex] - a.params[scoreParamIndex];
    }).filter(card => {
      return !searchQuery || (card.name && card.name.toLowerCase().includes(searchQuery.toLowerCase()));
    });

    // Create ID map for name lookup
    const idToName = {};
    types.forEach(function (t) { idToName[t.id] = t.name; });

    list.innerHTML = sortedTypes.map((card) => {
      const scoreVal = card.params[scoreParamIndex];
      const label = card.name || ('#' + (card.id + 1));

      // Store tooltip data in dataset
      const conditionsStr = (card.conditions && card.conditions.length)
        ? JSON.stringify(card.conditions.map(c => ({
          name: idToName[c.id] || ('#' + c.id),
          amount: c.amount
        })))
        : '';


      let hasScore = scoreVal > 0 ? ' has-score' : '';

      // 依存関係ハイライト
      if (dependencyHighlightId !== null) {
        if (card.id === dependencyHighlightId) {
          hasScore += ' dependency-source';
        } else if (requiredIds.includes(card.id)) {
          hasScore += ' dependency-highlight';
        } else {
          hasScore += ' dim'; // 関係ないものは薄くする
        }
      }
      const imageHtml = card.image
        ? '<img src="' + card.image + '" alt="' + card.name + '" class="card-image">'
        : '';

      return '<button type="button" class="card-chip' + hasScore + '" data-card-id="' + card.id + '" ' +
        'data-tooltip-title="' + label + '" ' +
        'data-tooltip-size="' + card.size + '×' + card.size + '" ' +
        'data-tooltip-score="' + scoreVal + '" ' +
        'data-tooltip-conditions=\'' + conditionsStr + '\'>' +
        '<span class="size-badge">' + card.size + '×' + card.size + '</span>' +
        '<span class="score-num">' + scoreVal + '</span>' +
        imageHtml +
        '<div class="card-info">' +
        '<span>' + label + '</span>' +
        '</div>' +
        '</button>';
    }).join('');

    list.querySelectorAll('.card-chip').forEach(function (btn) {
      btn.addEventListener('click', function () { selectCard(parseInt(btn.dataset.cardId, 10)); });
      btn.addEventListener('mouseenter', showTooltip);

      btn.addEventListener('mousemove', moveTooltip);
      btn.addEventListener('mouseleave', hideTooltip);
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        toggleDependencyHighlight(parseInt(btn.dataset.cardId, 10));
      });
    });
  }

  function toggleDependencyHighlight(cardId) {
    const list = document.getElementById('cardList');

    if (dependencyHighlightId === cardId) {
      dependencyHighlightId = null;
      renderAll();
      if (list) list.scrollTop = lastScrollTop;
    } else {
      if (dependencyHighlightId === null && list) {
        lastScrollTop = list.scrollTop;
      }
      dependencyHighlightId = cardId;
      renderAll();
      if (list) list.scrollTop = 0;
    }
  }

  function selectCard(cardTypeId) {
    if (destroyMode) {
      // 破壊モードを自動解除
      destroyMode = false;
      updateDestroyButton();
    }
    state.selectedCardTypeId = cardTypeId;
    document.querySelectorAll('.card-chip').forEach(function (el) {
      el.classList.toggle('selected', parseInt(el.dataset.cardId, 10) === cardTypeId);
    });
  }

  function renderBoard() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';
    const board = window.Game.getBoard(state);
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = board[r][c];
        const div = document.createElement('div');
        div.className = 'cell';
        div.dataset.row = r;
        div.dataset.col = c;
        if (!cell) {
          div.classList.add('empty');
          div.textContent = '';
        } else {
          const isOrigin = cell.originRow === r && cell.originCol === c;
          if (isOrigin) div.classList.add('origin');
          if (cell.isPlayerPlaced) div.classList.add('player');
          else div.classList.add('spawn');
          if (cell.size > 1) div.classList.add('size-' + cell.size);
          const card = state.cardTypes[cell.cardTypeId];
          const score = cell.isPlayerPlaced ? 0 : card.params[state.scoreParamIndex];
          if (isOrigin) {
            div.dataset.tooltipTitle = card.name || ('#' + (cell.cardTypeId + 1));
            div.dataset.tooltipScore = score;
            div.dataset.tooltipSize = card.size + '×' + card.size;

            // Add conditions for tooltip
            if (card.conditions && card.conditions.length) {
              // Note: need access to idToName or recreate it here, or store it in state
              // For now, let's keep it simple or access it if we can. 
              // Since renderBoard is separate, we'll reconstruct basic name lookup or just show ID
              // Better approach: pass idToName to renderBoard or store in state
              // For simplicity in this edit, we'll map ids as best we can or just use IDs

              // Let's rely on Game.getCardTypes(state) to get names
              const allParams = window.Game.getCardTypes(state);
              const nameMap = {};
              allParams.forEach(p => nameMap[p.id] = p.name);

              const conditionsStr = JSON.stringify(card.conditions.map(c => ({
                name: nameMap[c.id] || ('#' + c.id),
                amount: c.amount
              })));
              div.dataset.tooltipConditions = conditionsStr;
            }

            if (card.image) {
              div.innerHTML = '<img src="' + card.image + '" alt="' + card.name + '" class="cell-image">';
            } else {
              div.innerHTML = (card.name || ('#' + (cell.cardTypeId + 1)));
            }

            div.addEventListener('mouseenter', showTooltip);
            div.addEventListener('mousemove', moveTooltip);
            div.addEventListener('mouseleave', hideTooltip);
            div.addEventListener('contextmenu', function (e) {
              e.preventDefault();
              // mutationを右クリック → そのmutationを選択
              selectCard(cell.cardTypeId);
            });
          } else {
            div.textContent = '';
          }
        }
        boardEl.appendChild(div);
      }
    }
  }

  function renderMutationStats() {
    const statsEl = document.getElementById('mutationStats');

    // 各mutationの配置数をカウント
    const mutationCounts = {};
    const processedPlacements = new Set();

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = state.board[r][c];
        if (cell) {
          // 同じplacementIdを持つセルは1つのmutationとしてカウント
          const key = `${cell.placementId}`;
          if (!processedPlacements.has(key)) {
            processedPlacements.add(key);
            mutationCounts[cell.cardTypeId] = (mutationCounts[cell.cardTypeId] || 0) + 1;
          }
        }
      }
    }

    // カウントが0の場合
    if (Object.keys(mutationCounts).length === 0) {
      statsEl.innerHTML = '<h3>Placed Mutations</h3><div class="mutation-stats-list">No mutations placed yet</div>';
      return;
    }

    // HTML構築
    let html = '<h3>Placed Mutations</h3><div class="mutation-stats-list">';

    // カウント順にソート（降順）
    const sorted = Object.entries(mutationCounts).sort((a, b) => b[1] - a[1]);

    sorted.forEach(([cardTypeId, count]) => {
      const card = state.cardTypes[cardTypeId];
      if (card) {
        const label = state.scoreParamNames[card.name] || card.name;
        html += `<div class="mutation-stat-item"><span class="name">${label}</span><span class="count">×${count}</span></div>`;
      }
    });

    html += '</div>';
    statsEl.innerHTML = html;
  }


  function onCellClick(row, col, isDrag) {
    // ドラッグ時に同じセルでは再度処理しない
    if (isDrag && lastProcessedCell && lastProcessedCell.row === row && lastProcessedCell.col === col) {
      return;
    }

    if (destroyMode) {
      const success = window.Game.destroyCard(state, row, col);
      if (success) {
        // 履歴を保存（実行後、成功時のみ）
        window.Game.saveStateSnapshot(state);
        lastProcessedCell = { row, col };
        renderAll();
      }
      return;
    }
    if (state.selectedCardTypeId === null) return;

    // ドラッグ時はサイズ2以上のカードを上書きしない
    if (isDrag) {
      const card = state.cardTypes[state.selectedCardTypeId];
      const size = card ? card.size : 1;
      const boardSize = window.Game.BOARD_SIZE;

      for (let r = row; r < row + size; r++) {
        for (let c = col; c < col + size; c++) {
          if (r >= boardSize || c >= boardSize) continue;
          const cell = state.board[r][c];
          if (cell && cell.size >= 2) {
            return; // 保護
          }
        }
      }
    }

    // 同じマスに同じmutationを再設置する場合はスキップ
    const existingCell = state.board[row][col];
    if (existingCell && existingCell.cardTypeId === state.selectedCardTypeId) {
      const card = state.cardTypes[state.selectedCardTypeId];
      // サイズ1の場合：常にスキップ
      if (card.size === 1) {
        return;
      }
      // サイズ2以上の場合：同じ配置位置（origin）ならスキップ
      if (existingCell.originRow === row && existingCell.originCol === col) {
        return;
      }
    }

    const ok = window.Game.placeCard(state, row, col, state.selectedCardTypeId);
    if (ok) {
      // 履歴を保存（実行後）
      window.Game.saveStateSnapshot(state);
      lastProcessedCell = { row, col };
      renderAll();
    }
  }

  function onProgressClick() {
    window.Game.progress(state);
    // 履歴を保存（実行後）
    window.Game.saveStateSnapshot(state);
    renderAll();
  }

  function toggleDestroyMode() {
    destroyMode = !destroyMode;
    if (destroyMode) state.selectedCardTypeId = null;
    updateDestroyButton();
    document.querySelectorAll('.card-chip').forEach(function (el) { el.classList.remove('selected'); });
  }

  function updateDestroyButton() {
    const btn = document.getElementById('destroyModeBtn');
    btn.classList.toggle('active', destroyMode);
  }

  function updateHistoryButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = !window.Game.canUndo(state);
    if (redoBtn) redoBtn.disabled = !window.Game.canRedo(state);
  }

  function onUndo() {
    if (window.Game.undo(state)) {
      renderAll();
    }
  }

  function onRedo() {
    if (window.Game.redo(state)) {
      renderAll();
    }
  }

  // Tooltip Logic
  function showTooltip(e) {
    const tooltip = document.getElementById('tooltip');
    const target = e.currentTarget;
    const title = target.dataset.tooltipTitle;
    const score = target.dataset.tooltipScore;
    const size = target.dataset.tooltipSize;
    const conditions = target.dataset.tooltipConditions ? JSON.parse(target.dataset.tooltipConditions) : [];

    if (!title) return;

    let html = `
      <div class="tooltip-header">
        <span class="tooltip-title">${title}</span>
        <span class="tooltip-score">Score: ${score}</span>
      </div>
      <div class="tooltip-body">
        <div class="tooltip-row">
          <span>Size:</span>
          <span>${size}</span>
        </div>
    `;

    if (conditions.length > 0) {
      html += `
        <div class="tooltip-conditions">
          <div>Spawn Requirements:</div>
          ${conditions.map(c => `<span class="condition-item">• ${c.name} x${c.amount}</span>`).join('')}
        </div>
      `;
    }

    html += `</div>`;
    tooltip.innerHTML = html;
    tooltip.classList.add('visible');
    moveTooltip(e);
  }

  function moveTooltip(e) {
    const tooltip = document.getElementById('tooltip');
    if (!tooltip.classList.contains('visible')) return;

    // Position tooltip near mouse but prevent overflow
    const x = e.clientX + 15;
    const y = e.clientY + 15;

    // Check window bounds
    const rect = tooltip.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let finalX = x;
    let finalY = y;

    if (x + rect.width > winW) finalX = e.clientX - rect.width - 10;
    if (y + rect.height > winH) finalY = e.clientY - rect.height - 10;

    tooltip.style.left = finalX + 'px';
    tooltip.style.top = finalY + 'px';
  }

  function hideTooltip() {
    const tooltip = document.getElementById('tooltip');
    tooltip.classList.remove('visible');
  }

  function bindEvents() {
    document.addEventListener('mousedown', (e) => {
      // 左クリックのみをmousedownとして扱う
      if (e.button === 0) {
        isMouseDown = true;
        lastProcessedCell = null; // マウスダウン時にリセット
      }
    });
    document.addEventListener('mouseup', () => {
      isMouseDown = false;
      lastProcessedCell = null; // マウスアップ時にリセット
    });
    // 右クリック時もisMouseDownをfalseにする
    document.addEventListener('contextmenu', () => {
      isMouseDown = false;
      lastProcessedCell = null;
    });
    document.getElementById('progressBtn').addEventListener('click', onProgressClick);
    document.getElementById('destroyModeBtn').addEventListener('click', toggleDestroyMode);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('undoBtn').addEventListener('click', onUndo);
    document.getElementById('redoBtn').addEventListener('click', onRedo);
    document.getElementById('scoreParamSelector').addEventListener('change', onScoreParamChange);
    document.getElementById('mutationSearch').addEventListener('input', onSearchInput);

    // ボードのイベント委譲（重複を防ぐ）
    const boardEl = document.getElementById('board');
    boardEl.addEventListener('mousedown', function (e) {
      // 左クリックのみ処理
      if (e.button !== 0) return;

      const cell = e.target.closest('.cell');
      if (cell) {
        onCellClick(parseInt(cell.dataset.row, 10), parseInt(cell.dataset.col, 10), false);
      }
    });
    boardEl.addEventListener('mouseenter', function (e) {
      if (isMouseDown) {
        const cell = e.target.closest('.cell');
        if (cell) {
          onCellClick(parseInt(cell.dataset.row, 10), parseInt(cell.dataset.col, 10), true);
        }
      }
    }, true); // Use capture phase for mouseenter on child elements
    boardEl.addEventListener('contextmenu', function (e) {
      const cell = e.target.closest('.cell');
      if (cell) {
        e.preventDefault();
        const row = parseInt(cell.dataset.row, 10);
        const col = parseInt(cell.dataset.col, 10);
        const existingCell = state.board[row][col];

        if (!existingCell) {
          // 空のセルを右クリック → 破壊モードを起動
          destroyMode = true;
          state.selectedCardTypeId = null;
          updateDestroyButton();
          document.querySelectorAll('.card-chip').forEach(function (el) { el.classList.remove('selected'); });
        }
        // mutationがある場合の処理は各セルのイベントハンドラで処理済み
      }
    });

    // キーボードショートカット
    document.addEventListener('keydown', function (e) {
      // Ctrl+Z: Undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      }
      // Ctrl+Y or Ctrl+Shift+Z: Redo
      else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        onRedo();
      }
    });
  }

  function onSearchInput(e) {
    searchQuery = e.target.value;
    renderCardList();
  }

  function clearAll() {
    if (!confirm('Are you sure you want to clear all mutations?')) return;

    // 履歴を保存
    window.Game.saveStateSnapshot(state);

    for (let r = 0; r < window.Game.BOARD_SIZE; r++) {
      for (let c = 0; c < window.Game.BOARD_SIZE; c++) {
        state.board[r][c] = null;
      }
    }
    renderAll();
  }

  function onScoreParamChange(e) {
    const newIndex = parseInt(e.target.value, 10);
    state.scoreParamIndex = newIndex;
    state.scoreParamName = state.scoreParams[newIndex];
    renderAll();
  }

  init();
})();
