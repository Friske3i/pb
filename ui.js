(function () {
  const BOARD_SIZE = window.Game.BOARD_SIZE;
  let state = null;
  let destroyMode = false;
  let searchQuery = '';
  let dependencyHighlightId = null;
  let lastScrollTop = 0;
  let isMouseDown = false;

  function init() {
    window.Game.loadConfig()
      .then(function (config) {
        state = window.Game.createGameState(config);
        destroyMode = false;
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
              toggleDependencyHighlight(cell.cardTypeId);
            });
          } else {
            div.textContent = '';
          }
        }
        boardEl.appendChild(div);
      }
    }

    boardEl.querySelectorAll('.cell').forEach(function (el) {
      el.addEventListener('mousedown', function () {
        onCellClick(parseInt(el.dataset.row, 10), parseInt(el.dataset.col, 10), false);
      });
      el.addEventListener('mouseenter', function () {
        if (isMouseDown) {
          onCellClick(parseInt(el.dataset.row, 10), parseInt(el.dataset.col, 10), true);
        }
      });
    });
  }

  function onCellClick(row, col, isDrag) {
    if (destroyMode) {
      window.Game.destroyCard(state, row, col);
      renderAll();
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

    const ok = window.Game.placeCard(state, row, col, state.selectedCardTypeId);
    if (ok) renderAll();
  }

  function onProgressClick() {
    window.Game.progress(state);
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
    document.addEventListener('mousedown', () => isMouseDown = true);
    document.addEventListener('mouseup', () => isMouseDown = false);
    document.getElementById('progressBtn').addEventListener('click', onProgressClick);
    document.getElementById('destroyModeBtn').addEventListener('click', toggleDestroyMode);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('scoreParamSelector').addEventListener('change', onScoreParamChange);
    document.getElementById('mutationSearch').addEventListener('input', onSearchInput);
  }

  function onSearchInput(e) {
    searchQuery = e.target.value;
    renderCardList();
  }

  function clearAll() {
    if (!confirm('Are you sure you want to clear all mutations?')) return;
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
