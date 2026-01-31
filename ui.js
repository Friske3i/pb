(function () {
  const BOARD_SIZE = window.Game.BOARD_SIZE;
  let state = null;
  let destroyMode = false;

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
    renderScoreParam();
    renderScore();
    renderSpawnHint();
    renderCardList();
    renderBoard();
    updateDestroyButton();
  }

  function renderScoreParam() {
    const { name } = window.Game.getScoreParam(state);
    document.getElementById('scoreParamName').textContent = name;
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
    list.innerHTML = types.map((card) => {
      const scoreVal = card.params[scoreParamIndex];
      const label = card.name || ('#' + (card.id + 1));
      const condText = (card.conditions && card.conditions.length)
        ? ' 出現: ' + card.conditions.map(function (c) { return 'id' + c.id + 'が' + c.amount + '枚以上'; }).join(' または ')
        : '';
      const title = card.name + ' サイズ' + card.size + '×' + card.size + condText;
      return '<button type="button" class="card-chip" data-card-id="' + card.id + '" title="' + title + '">' +
        '<span class="size-badge">' + card.size + '×' + card.size + '</span> ' +
        '<span>' + label + '</span> ' +
        '<span class="score-num">(' + scoreVal + ')</span>' +
        '</button>';
    }).join('');

    list.querySelectorAll('.card-chip').forEach(function (btn) {
      btn.addEventListener('click', function () { selectCard(parseInt(btn.dataset.cardId, 10)); });
    });
  }

  function selectCard(cardTypeId) {
    if (destroyMode) return;
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
          if (cell.isPlayerPlaced) div.classList.add('player');
          else div.classList.add('spawn');
          if (cell.size > 1) div.classList.add('size-' + cell.size);
          const card = state.cardTypes[cell.cardTypeId];
          const score = cell.isPlayerPlaced ? 0 : card.params[state.scoreParamIndex];
          if (isOrigin) {
            div.innerHTML = (card.name || ('#' + (cell.cardTypeId + 1))) + '<span class="score-num">' + score + '</span>';
          } else {
            div.textContent = '';
          }
        }
        boardEl.appendChild(div);
      }
    }

    boardEl.querySelectorAll('.cell').forEach(function (el) {
      el.addEventListener('click', function () {
        onCellClick(parseInt(el.dataset.row, 10), parseInt(el.dataset.col, 10));
      });
    });
  }

  function onCellClick(row, col) {
    if (destroyMode) {
      window.Game.destroyCard(state, row, col);
      renderAll();
      return;
    }
    if (state.selectedCardTypeId === null) return;
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
    btn.textContent = destroyMode ? '破壊モード ON' : '破壊モード';
    btn.classList.toggle('active', destroyMode);
  }

  function bindEvents() {
    document.getElementById('progressBtn').addEventListener('click', onProgressClick);
    document.getElementById('destroyModeBtn').addEventListener('click', toggleDestroyMode);
  }

  init();
})();
