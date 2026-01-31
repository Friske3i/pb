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
    renderSpawnHint();
    renderMutationList();
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

  function renderMutationList() {
    const list = document.getElementById('mutationList');
    const types = window.Game.getMutationTypes(state);
    const { index: scoreParamIndex } = window.Game.getScoreParam(state);

    // スコア順にソート（降順）
    // スコア順にソート（降順）
    // 依存関係ハイライト時は、必要なカードを優先
    let requiredIds = [];
    if (dependencyHighlightId !== null) {
      const targetMutation = types.find(c => c.id === dependencyHighlightId);
      if (targetMutation && targetMutation.conditions) {
        requiredIds = targetMutation.conditions.map(c => c.id);
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
    }).filter(mutation => {
      return !searchQuery || (mutation.name && mutation.name.toLowerCase().includes(searchQuery.toLowerCase()));
    });

    // Create ID map for name lookup
    const idToName = {};
    types.forEach(function (t) { idToName[t.id] = t.name; });

    list.innerHTML = sortedTypes.map((mutation) => {
      const scoreVal = mutation.params[scoreParamIndex];
      const label = mutation.name || ('#' + (mutation.id + 1));

      // Store tooltip data in dataset
      const conditionsStr = (mutation.conditions && mutation.conditions.length)
        ? JSON.stringify(mutation.conditions.map(c => ({
          name: idToName[c.id] || ('#' + c.id),
          amount: c.amount
        })))
        : '';


      let hasScore = scoreVal > 0 ? ' has-score' : '';

      // 依存関係ハイライト
      if (dependencyHighlightId !== null) {
        if (mutation.id === dependencyHighlightId) {
          hasScore += ' dependency-source';
        } else if (requiredIds.includes(mutation.id)) {
          hasScore += ' dependency-highlight';
        } else {
          hasScore += ' dim'; // 関係ないものは薄くする
        }
      }
      const imageHtml = mutation.image
        ? '<img src="' + mutation.image + '" alt="' + mutation.name + '" class="mutation-image">'
        : '';

      return '<button type="button" class="mutation-chip' + hasScore + '" data-mutation-id="' + mutation.id + '" ' +
        'data-tooltip-title="' + label + '" ' +
        'data-tooltip-size="' + mutation.size + '×' + mutation.size + '" ' +
        'data-tooltip-score="' + scoreVal + '" ' +
        'data-tooltip-conditions=\'' + conditionsStr + '\'>' +
        '<span class="size-badge">' + mutation.size + '×' + mutation.size + '</span>' +
        '<span class="score-num">' + scoreVal + '</span>' +
        imageHtml +
        '<div class="mutation-info">' +
        '<span>' + label + '</span>' +
        '</div>' +
        '</button>';
    }).join('');

    list.querySelectorAll('.mutation-chip').forEach(function (btn) {
      btn.addEventListener('click', function () { selectMutation(parseInt(btn.dataset.mutationId, 10)); });
      btn.addEventListener('mouseenter', showTooltip);

      btn.addEventListener('mousemove', moveTooltip);
      btn.addEventListener('mouseleave', hideTooltip);
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        toggleDependencyHighlight(parseInt(btn.dataset.mutationId, 10));
      });
    });
  }

  function toggleDependencyHighlight(mutationId) {
    const list = document.getElementById('mutationList');

    if (dependencyHighlightId === mutationId) {
      dependencyHighlightId = null;
      renderAll();
      if (list) list.scrollTop = lastScrollTop;
    } else {
      if (dependencyHighlightId === null && list) {
        lastScrollTop = list.scrollTop;
      }
      dependencyHighlightId = mutationId;
      renderAll();
      if (list) list.scrollTop = 0;
    }
  }

  function selectMutation(mutationId) {
    if (destroyMode) {
      // 破壊モードを自動解除
      destroyMode = false;
      updateDestroyButton();
    }
    state.selectedMutationId = mutationId;
    document.querySelectorAll('.mutation-chip').forEach(function (el) {
      el.classList.toggle('selected', parseInt(el.dataset.mutationId, 10) === mutationId);
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
          const mutation = state.mutationTypes[cell.mutationId];

          let score = mutation.params[state.scoreParamIndex] ?? 0;
          if (state.simulationMode) {
            const growthStage = cell.growthStage !== undefined ? cell.growthStage : 0;
            const maxGrowthStage = mutation.maxGrowthStage !== undefined ? mutation.maxGrowthStage : 1;
            const isFullyGrown = (maxGrowthStage === 0) || (growthStage >= maxGrowthStage);

            if (cell.isPlayerPlaced && mutation.category === 'mutated') {
              score = 0;
            } else if (!isFullyGrown) {
              score = 0;
            }
          } else {
            if (cell.isPlayerPlaced) {
              score = 0;
            }
          }

          if (isOrigin) {
            div.dataset.tooltipTitle = mutation.name || ('#' + (cell.mutationId + 1));
            div.dataset.tooltipScore = score;
            div.dataset.tooltipSize = mutation.size + '×' + mutation.size;

            // 成長段階情報をツールチップ用に追加
            if (cell.growthStage !== undefined) {
              div.dataset.tooltipGrowthStage = cell.growthStage;
              div.dataset.tooltipMaxGrowthStage = (mutation.maxGrowthStage !== undefined) ? mutation.maxGrowthStage : 1;
              div.dataset.tooltipIsPlayerPlaced = cell.isPlayerPlaced;
              div.dataset.tooltipCategory = mutation.category;
              div.dataset.tooltipSpecialEffect = mutation.specialEffect;
            }

            // Add conditions for tooltip
            if (mutation.conditions && mutation.conditions.length) {
              // Note: need access to idToName or recreate it here, or store it in state
              // For now, let's keep it simple or access it if we can. 
              // Since renderBoard is separate, we'll reconstruct basic name lookup or just show ID
              // Better approach: pass idToName to renderBoard or store in state
              // For simplicity in this edit, we'll map ids as best we can or just use IDs

              // Let's rely on Game.getMutationTypes(state) to get names
              const allParams = window.Game.getMutationTypes(state);
              const nameMap = {};
              allParams.forEach(p => nameMap[p.id] = p.name);

              const conditionsStr = JSON.stringify(mutation.conditions.map(c => ({
                name: nameMap[c.id] || ('#' + c.id),
                amount: c.amount
              })));
              div.dataset.tooltipConditions = conditionsStr;
            }

            if (mutation.image) {
              div.innerHTML = '<img src="' + mutation.image + '" alt="' + mutation.name + '" class="cell-image">';
            } else {
              div.innerHTML = (mutation.name || ('#' + (cell.mutationId + 1)));
            }

            // シミュレーションモード: 成長段階インジケーターを表示
            if (state.simulationMode) {
              const growthStage = cell.growthStage !== undefined ? cell.growthStage : 0;
              const maxGrowthStage = mutation.maxGrowthStage !== undefined ? mutation.maxGrowthStage : 1;
              // maxGrowthStage=0の場合は常にfully grown、それ以外はgrowthStage >= maxGrowthStage
              // 特例: Glasscornは7,8で完了
              let isFullyGrown;
              if (mutation.specialEffect === 'glasscorn') {
                isFullyGrown = (growthStage === 7 || growthStage === 8);
              } else {
                isFullyGrown = (maxGrowthStage === 0) || (growthStage >= maxGrowthStage);
              }

              // 成長段階のクラスを追加
              if (isFullyGrown) {
                div.classList.add('fully-grown');
              } else {
                div.classList.add('growing');
              }

              // 成長段階テキストを表示（すべてのケースで表示、数字/数字形式のみ）
              const stageIndicator = document.createElement('div');
              stageIndicator.className = 'growth-stage';
              stageIndicator.textContent = growthStage + '/' + maxGrowthStage;
              div.appendChild(stageIndicator);
            }

            div.addEventListener('mouseenter', showTooltip);
            div.addEventListener('mousemove', moveTooltip);
            div.addEventListener('mouseleave', hideTooltip);
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
    const boardEl = document.getElementById('board');
    if (!statsEl) return;

    // 盤面の幅に合わせる
    if (boardEl) {
      statsEl.style.width = boardEl.offsetWidth + 'px';
      statsEl.style.maxWidth = '100%'; // はみ出し防止
      statsEl.style.boxSizing = 'border-box'; // パディングを含めて幅を計算
    }
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
            mutationCounts[cell.mutationId] = (mutationCounts[cell.mutationId] || 0) + 1;
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

    sorted.forEach(([mutationId, count]) => {
      const mutation = state.mutationTypes[mutationId];
      if (mutation) {
        const label = state.scoreParamNames[mutation.name] || mutation.name;
        const imageHtml = mutation.image
          ? `<img src="${mutation.image}" alt="${label}" class="icon">`
          : '';
        html += `<div class="mutation-stat-item">${imageHtml}<span class="name">${label}</span><span class="count">×${count}</span></div>`;
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
      const success = window.Game.destroyMutation(state, row, col);
      if (success) {
        // 履歴を保存（実行後、成功時のみ）
        window.Game.saveStateSnapshot(state);
        lastProcessedCell = { row, col };
        renderAll();
        hideTooltip(); // 破壊後はツールチップを隠す
      }
      return;
    }
    if (state.selectedMutationId === null) return;

    if (!canPlaceMutation(row, col, state.selectedMutationId, isDrag)) {
      return;
    }

    const ok = window.Game.placeMutation(state, row, col, state.selectedMutationId);
    if (ok) {
      // 履歴を保存（実行後）
      window.Game.saveStateSnapshot(state);
      lastProcessedCell = { row, col };
      renderAll();
    }
  }

  function canPlaceMutation(row, col, mutationId, isDrag) {
    // ドラッグ時はサイズ2以上のカードを上書きしない
    if (isDrag) {
      const mutation = state.mutationTypes[mutationId];
      const size = mutation ? mutation.size : 1;
      const boardSize = window.Game.BOARD_SIZE;

      for (let r = row; r < row + size; r++) {
        for (let c = col; c < col + size; c++) {
          if (r >= boardSize || c >= boardSize) continue;
          const cell = state.board[r][c];
          if (cell && cell.size >= 2) {
            return false;
          }
        }
      }
    }

    // 同じマスに同じmutationを再設置する場合のチェック
    const existingCell = state.board[row][col];
    if (existingCell && existingCell.mutationId === mutationId) {
      // Simulation Mode: リセット（growthStageの変更）が必要な場合は許可
      if (state.simulationMode) {
        const mutation = state.mutationTypes[mutationId];
        const initialStage = (mutation.category === 'mutated') ? mutation.maxGrowthStage : 0;
        // 既存のgrowthStageが初期値と異なる場合は、リセットのために上書きを許可する
        if (existingCell.growthStage !== initialStage) {
          return true;
        }
      }

      // 以下、再設置が不要（冗長）な場合はfalseを返す
      const mutation = state.mutationTypes[mutationId];
      if (mutation.size === 1) return false;

      // サイズ2以上の場合、原点をクリックした場合は「まったく同じ位置への上書き」なのでスキップ
      if (existingCell.originRow === row && existingCell.originCol === col) return false;
    }

    return true;
  }
  async function onCopyImageClick() {
    const btn = document.getElementById('copyImageBtn');
    const originalText = btn.textContent;

    // html2canvasの存在チェック
    if (typeof html2canvas === 'undefined') {
      btn.textContent = 'Error: Library not loaded';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
      return;
    }

    btn.textContent = 'Capturing...';
    btn.disabled = true;

    let container = null; // containerをtryブロックの外で宣言
    try {
      // 1. 画面外に専用コンテナを作成
      container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '-9999px';
      // コンテナ自体は中身にフィットさせる（初期状態）
      container.style.width = 'fit-content';
      container.style.height = 'fit-content';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.alignItems = 'center'; // 横方向中央揃え
      container.style.justifyContent = 'center'; // 縦方向中央揃え
      container.style.backgroundColor = '#1e1e24';
      container.style.padding = '40px'; // 余白を大きく
      container.style.borderRadius = '12px';
      // 余計なスペースを防ぐ
      container.style.boxSizing = 'border-box';

      // 2. ボードとスタッツをクローン
      const boardEl = document.getElementById('board');
      const statsEl = document.getElementById('mutationStats');
      if (!boardEl || !statsEl) {
        throw new Error('Required elements (board or mutationStats) not found');
      }

      const boardClone = boardEl.cloneNode(true);
      const statsClone = statsEl.cloneNode(true);

      // 盤面のスタイルを強制上書き
      boardClone.style.margin = '0';
      boardClone.style.boxShadow = 'none';
      boardClone.style.width = boardEl.offsetWidth + 'px';
      boardClone.style.height = boardEl.offsetHeight + 'px';
      boardClone.style.flex = 'none';

      // 統計のスタイルを強制上書き
      statsClone.style.margin = '16px 0 0 0';
      statsClone.style.width = boardEl.offsetWidth + 'px';
      statsClone.style.maxWidth = 'none';
      statsClone.style.boxSizing = 'border-box';
      statsClone.style.flex = 'none';

      // プレビューオーバーレイを削除（スクリーンショットに含めない）
      const previews = boardClone.querySelectorAll('.preview-overlay');
      previews.forEach(p => p.remove());

      container.appendChild(boardClone);
      container.appendChild(statsClone);
      document.body.appendChild(container);

      // 3. サイズを測定
      const rect = container.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);

      // 4. 正方形に強制（中央揃えを維持）
      container.style.width = size + 'px';
      container.style.height = size + 'px';

      // 5. html2canvasでキャプチャ
      const canvas = await html2canvas(container, {
        backgroundColor: null,
        scale: 2,
        logging: false,
        useCORS: true
      });

      // 6. クリップボードにコピー
      canvas.toBlob(async (blob) => {
        try {
          if (!blob) throw new Error('Blob creation failed');
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          btn.textContent = 'Copied!';
        } catch (err) {
          console.error('Clipboard write failed:', err);
          // Fallback: ダウンロード
          if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'mutation_plan.png';
            link.click();
            URL.revokeObjectURL(url);
            btn.textContent = 'Downloaded';
          } else {
            btn.textContent = 'Failed';
          }
        } finally {
          // 確実にクリーンアップ
          if (container && container.parentNode) {
            document.body.removeChild(container);
          }
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
          }, 2000);
        }
      });

    } catch (err) {
      console.error('Screenshot failed:', err);
      btn.textContent = 'Error';

      // エラー時のクリーンアップ
      if (container && container.parentNode) {
        document.body.removeChild(container);
      }

      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
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
    if (destroyMode) state.selectedMutationId = null;
    updateDestroyButton();
    document.querySelectorAll('.mutation-chip').forEach(function (el) { el.classList.remove('selected'); });
  }

  function updateDestroyButton() {
    const btn = document.getElementById('destroyModeBtn');
    btn.classList.toggle('active', destroyMode);

    // ボードにもクラスを付与してカーソル制御などを可能にする
    const boardEl = document.getElementById('board');
    if (boardEl) {
      boardEl.classList.toggle('destroy-mode', destroyMode);
    }
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
    if (isMouseDown) return; // ドラッグ中（破壊モードのスライドなど）はツールチップを表示しない
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

    // 成長段階情報を追加（シミュレーションモード時）
    const growthStage = target.dataset.tooltipGrowthStage;
    const maxGrowthStage = target.dataset.tooltipMaxGrowthStage;
    const isPlayerPlaced = target.dataset.tooltipIsPlayerPlaced;
    const category = target.dataset.tooltipCategory;
    const specialEffect = target.dataset.tooltipSpecialEffect;

    if (state.simulationMode && growthStage !== undefined && maxGrowthStage) {
      const stage = parseInt(growthStage, 10);
      const maxStage = parseInt(maxGrowthStage, 10);
      // maxGrowthStage=0の場合は常にfully grown、それ以外はstage >= maxStage
      let isFullyGrown;
      if (specialEffect === 'glasscorn') {
        isFullyGrown = (stage === 7 || stage === 8);
      } else {
        isFullyGrown = (maxStage === 0) || (stage >= maxStage);
      }
      const statusText = isFullyGrown ? ' (Fully Grown)' : '';

      // プレイヤー設置のmutatedには(uncollectable)を追加
      const uncollectableText = (isPlayerPlaced === 'true' && category === 'mutated') ? ' (uncollectable)' : '';

      html += `
        <div class="tooltip-row">
          <span>Growth:</span>
          <span>${stage}/${maxStage}${statusText}${uncollectableText}</span>
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


  // --- Preview Logic ---
  let currentPreview = null;

  function renderPreview(row, col) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    // 既存プレビュー削除（競合状態を防ぐため最初に実行）
    clearPreview();

    if (state.selectedMutationId === null || destroyMode || isMouseDown) return;

    const mutation = state.mutationTypes[state.selectedMutationId];
    if (!mutation) return;

    // 配置可否を簡易チェック（上書きルールなどは複雑なので、基本は表示しつつ色を変えるなどで対応も可）
    // ここでは単純に表示する

    const preview = document.createElement('div');
    preview.className = 'preview-overlay';

    // サイズ対応
    const size = mutation.size || 1;
    if (size > 1) preview.classList.add('size-' + size);

    // 位置設定 (Grid Layoutを利用)
    // CSS Gridのライン番号は1始まり
    preview.style.gridRowStart = row + 1;
    preview.style.gridColumnStart = col + 1;
    preview.style.gridRowEnd = 'span ' + size;
    preview.style.gridColumnEnd = 'span ' + size;

    // 画像があれば表示
    if (mutation.image) {
      const img = document.createElement('img');
      img.src = mutation.image;
      preview.appendChild(img);
    } else {
      // 文字で表示の場合
      preview.textContent = mutation.name || '';
      preview.style.color = '#fff';
      preview.style.fontSize = '0.8rem';
    }

    // 盤面からはみ出る場合はInvalidスタイル（あるいは表示しない）
    const boardSize = window.Game.BOARD_SIZE || 10; // フォールバック
    if (row + size > boardSize || col + size > boardSize) {
      preview.classList.add('invalid');
    }

    boardEl.appendChild(preview);
    currentPreview = preview;
  }

  function clearPreview() {
    if (currentPreview) {
      if (currentPreview.parentNode) currentPreview.parentNode.removeChild(currentPreview);
      currentPreview = null;
    }
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
    document.getElementById('copyImageBtn').addEventListener('click', onCopyImageClick);
    document.getElementById('destroyModeBtn').addEventListener('click', toggleDestroyMode);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('undoBtn').addEventListener('click', onUndo);
    document.getElementById('redoBtn').addEventListener('click', onRedo);
    document.getElementById('scoreParamSelector').addEventListener('change', onScoreParamChange);
    document.getElementById('mutationSearch').addEventListener('input', onSearchInput);

    // シミュレーションモードトグル
    document.getElementById('simulationModeToggle').addEventListener('change', function (e) {
      state.simulationMode = e.target.checked;
      renderAll(); // 全体を再描画してスコアや成長段階などを更新
    });

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
    boardEl.addEventListener('mouseover', function (e) {
      if (isMouseDown) return;
      const cell = e.target.closest('.cell');
      if (!cell) return;

      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);

      // Destroy Mode Highlight
      if (destroyMode) {
        const targetCell = state.board[r][c];
        if (targetCell && targetCell.mutationId !== undefined) {
          // 同じplacementIdを持つ全てのセルをハイライト
          const pid = targetCell.placementId;

          // state.boardを走査して該当セルを特定（DOMクエリを削減）
          for (let row = 0; row < state.board.length; row++) {
            for (let col = 0; col < state.board[row].length; col++) {
              const cellData = state.board[row][col];
              if (cellData && cellData.placementId === pid) {
                // 該当するDOM要素を取得
                const cellEl = boardEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                if (cellEl) {
                  cellEl.classList.add('will-destroy');
                }
              }
            }
          }
        }
        return; // プレビューは表示しない
      }

      // Preview
      renderPreview(r, c);
    });

    boardEl.addEventListener('mouseout', function (e) {
      const cell = e.target.closest('.cell');
      if (cell) {
        // Destroy Mode Highlight Cleanup
        if (destroyMode) {
          const cells = boardEl.querySelectorAll('.cell.will-destroy');
          cells.forEach(el => el.classList.remove('will-destroy'));
        }
      }
    });
    boardEl.addEventListener('mouseleave', function () {
      clearPreview();
    });

    boardEl.addEventListener('contextmenu', function (e) {
      const cell = e.target.closest('.cell');
      if (cell) {
        e.preventDefault();
        const row = parseInt(cell.dataset.row, 10);
        const col = parseInt(cell.dataset.col, 10);
        const existingCell = state.board[row][col];

        if (!existingCell) {
          // 空のセルを右クリック → 破壊モードを起動
          clearPreview(); // プレビューを消去
          destroyMode = true;
          state.selectedMutationId = null;
          updateDestroyButton();
          document.querySelectorAll('.mutation-chip').forEach(function (el) { el.classList.remove('selected'); });
        } else {
          // mutationを右クリック → そのmutationを選択
          selectMutation(existingCell.mutationId);
        }
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
    renderMutationList();
  }

  function clearAll() {
    if (!confirm('Are you sure you want to clear all mutations?')) return;

    for (let r = 0; r < window.Game.BOARD_SIZE; r++) {
      for (let c = 0; c < window.Game.BOARD_SIZE; c++) {
        state.board[r][c] = null;
      }
    }

    // 履歴を保存（実行後）
    window.Game.saveStateSnapshot(state);
    renderAll();
  }

  function onScoreParamChange(e) {
    const newIndex = parseInt(e.target.value, 10);
    state.scoreParamIndex = newIndex;
    state.scoreParamName = state.scoreParams[newIndex];
    renderAll();
  }

  async function init() {
    const config = await window.Game.loadConfig();
    state = window.Game.createGameState(config);
    renderMutationList();
    renderAll();
    bindEvents();
    updateDestroyButton();
    updateHistoryButtons();
  }

  init();
})();
