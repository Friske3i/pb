/**
 * Mutation Planner - 10x10 格子カードゲーム
 * 設定は config.json から参照（スコアパラメータ・周辺条件・カード定義）
 */

const BOARD_SIZE = 10;

// config.cards を内部用に正規化: params と出現条件(conditions)を保持
function normalizeCard(card, scoreParams, id) {
  const params = scoreParams.map(p => card.scores?.[p] ?? card[p] ?? 0);
  const conditions = card.conditions ?? card.spawnCondition?.conditions ?? [];
  const category = card.category ?? 'basecrop'; // デフォルトはbasecrop
  const maxGrowthStage = card.maxGrowthStage ?? 1; // デフォルトは1（即座に成長完了）
  return {
    id: id ?? card.id,
    name: card.name,
    size: card.size,
    params,
    conditions,
    image: card.image,
    category,
    maxGrowthStage,
    specialEffect: card.specialEffect
  };
}

// 出現するカードのサイズに応じた「周囲」のマスを返す（盤面外は含まない）
// サイズ1: 8マス、サイズ2: 12マス、サイズ3: 16マス
function getSurroundingCells(row, col, size) {
  const out = [];
  if (size === 1) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr, c = col + dc;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) out.push({ r, c });
      }
    }
    return out; // 最大8
  }
  if (size === 2) {
    // 4x4 (row-1..row+2, col-1..col+2) のうち 2x2 (row..row+1, col..col+1) を除く → 12マス
    for (let r = row - 1; r <= row + 2; r++) {
      for (let c = col - 1; c <= col + 2; c++) {
        if (r >= row && r <= row + 1 && c >= col && c <= col + 1) continue;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) out.push({ r, c });
      }
    }
    return out;
  }
  if (size === 3) {
    // 5x5 (row-1..row+3, col-1..col+3) のうち 3x3 (row..row+2, col..col+2) を除く → 16マス
    for (let r = row - 1; r <= row + 3; r++) {
      for (let c = col - 1; c <= col + 3; c++) {
        if (r >= row && r <= row + 2 && c >= col && c <= col + 2) continue;
        if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) out.push({ r, c });
      }
    }
    return out;
  }
  return out;
}

// 空地に spawnSize のカードを出現させる条件が満たされているか
// カード生成の計算では「1マス当たり1枚」でカウント（サイズ2以上のカードは占有マス数ぶん加算）
// conditions: [{ id: 5, amount: 3 }, { id: 7, amount: 6 }]
// すべての条件を満たす必要がある（AND条件）
function isEmptyAndSatisfiesCondition(board, row, col, conditions, spawnSize) {
  if (board[row][col] !== null) return false;
  if (!conditions || conditions.length === 0) return false;
  const cellCountByType = {}; // 周囲の「マス」ごとに1枚とカウント
  const surrounding = getSurroundingCells(row, col, spawnSize);
  for (const { r, c } of surrounding) {
    const cell = board[r][c];
    if (!cell) continue;
    const id = cell.cardTypeId;
    cellCountByType[id] = (cellCountByType[id] || 0) + 1;
  }
  // すべての条件を満たす必要がある
  for (const cond of conditions) {
    const count = cellCountByType[cond.id] || 0;
    if (count < cond.amount) return false; // 1つでも満たさなければfalse
  }
  return true; // すべて満たせばtrue
}

// (row,col) を左上として size x size がすべて空いているか
function isAreaEmpty(board, row, col, size) {
  for (let r = row; r < row + size; r++) {
    for (let c = col; c < col + size; c++) {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE || board[r][c] !== null)
        return false;
    }
  }
  return true;
}

function createEmptyBoard() {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
}

// config は config.json の内容（scoreParams, spawnCondition, cards）
function createGameState(config) {
  const scoreParams = config.scoreParams || [];
  const cardTypes = (config.cards || []).map((card, i) => normalizeCard(card, scoreParams, i));
  const scoreParamIndex = 0; // Wheat固定
  return {
    board: createEmptyBoard(),
    cardTypes,
    scoreParamIndex,
    scoreParamName: scoreParams[scoreParamIndex] || '—',
    scoreParams,
    scoreParamNames: config.scoreParamNames || {},
    selectedCardTypeId: null,
    placementIdCounter: 0,
    simulationMode: false, // シミュレーションモード（成長段階システム）
    history: [],
    historyIndex: -1
  };
}

// スコア計算: 盤面上の「出現カード」のみ。サイズ2以上も全体で1枚として1回だけ加算
function calculateScore(state) {
  let total = 0;
  const counted = new Set();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r][c];
      if (!cell) continue;

      const key = `${cell.originRow},${cell.originCol}`;
      if (counted.has(key)) continue;
      counted.add(key);

      const card = state.cardTypes[cell.cardTypeId];

      // シミュレーションモードがオフの場合: プレイヤー設置は常にスコア0（従来の動作）
      if (!state.simulationMode && cell.isPlayerPlaced) continue;

      // シミュレーションモードがオンの場合: プレイヤー設置のmutatedのみスコア0（uncollectable）
      if (state.simulationMode && cell.isPlayerPlaced && card.category === 'mutated') continue;

      // 成長段階チェック: Glasscornは7,8で完了扱い
      if (card.specialEffect === 'glasscorn') {
        if (cell.growthStage !== 7 && cell.growthStage !== 8) continue;
      } else {
        if (card.maxGrowthStage > 0 && cell.growthStage < card.maxGrowthStage) continue;
      }

      // 成長完了したMutationはスコアを持つ
      total += card.params[state.scoreParamIndex] ?? 0;
    }
  }
  return total;
}

function placeCard(state, row, col, cardTypeId) {
  const card = state.cardTypes[cardTypeId];
  if (!card) return false;
  const size = card.size;

  // 範囲チェック（盤面外には置けない）
  if (row < 0 || row + size > BOARD_SIZE || col < 0 || col + size > BOARD_SIZE) {
    return false;
  }

  // 重なる既存カードを収集
  const overlapping = [];
  for (let r = row; r < row + size; r++) {
    for (let c = col; c < col + size; c++) {
      const cell = state.board[r][c];
      if (cell) {
        if (!overlapping.some(item => item.row === cell.originRow && item.col === cell.originCol)) {
          overlapping.push({ row: cell.originRow, col: cell.originCol });
        }
      }
    }
  }

  // 重なるカードを削除（履歴保存なし）
  overlapping.forEach(pos => destroyCardInternal(state, pos.row, pos.col));

  // 成長段階の初期値を決定（0から始まる）
  let growthStage;
  if (state.simulationMode) {
    // シミュレーションモード: カテゴリに応じて初期値を設定
    growthStage = (card.category === 'mutated') ? card.maxGrowthStage : 0;
  } else {
    // 非シミュレーションモード: 常に最大値（成長完了状態）
    growthStage = card.maxGrowthStage;
  }

  const placementId = state.placementIdCounter++;
  for (let r = row; r < row + size; r++) {
    for (let c = col; c < col + size; c++) {
      state.board[r][c] = {
        cardTypeId,
        isPlayerPlaced: true,
        growthStage, // 成長段階を追加
        originRow: row,
        originCol: col,
        size,
        placementId,
        row: r,
        col: c
      };
    }
  }
  return true;
}

function destroyCard(state, row, col) {
  const cell = state.board[row][col];
  if (!cell) return false;

  destroyCardInternal(state, row, col);
  return true;
}

// 内部用: 履歴を保存せずにカードを破壊
function destroyCardInternal(state, row, col) {
  const cell = state.board[row][col];
  if (!cell) return false;

  const { originRow, originCol, size } = cell;
  for (let r = originRow; r < originRow + size; r++) {
    for (let c = originCol; c < originCol + size; c++) {
      state.board[r][c] = null;
    }
  }
  return true;
}

function progress(state) {
  // シミュレーションモード: 既存のMutationの成長段階を進める
  if (state.simulationMode) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = state.board[r][c];
        if (cell) {
          const card = state.cardTypes[cell.cardTypeId];
          // Glasscorn: maxGrowthStage (9) まで育ち、次は1に戻る
          if (card.specialEffect === 'glasscorn') {
            if (cell.growthStage >= card.maxGrowthStage - 1) {
              cell.growthStage = 1;
            } else {
              cell.growthStage++;
            }
          } else {
            // 通常: 成長段階が最大値未満なら1増やす
            if (cell.growthStage < card.maxGrowthStage) {
              cell.growthStage++;
            }
          }
        }
      }
    }
  }

  // 空きセルを収集
  const emptyCells = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] === null) emptyCells.push({ r, c });
    }
  }
  shuffle(emptyCells);

  // 各カードタイプについて、出現条件を満たす空きセルを探す
  for (const card of state.cardTypes) {
    if (!card.conditions || card.conditions.length === 0) continue;
    const size = card.size;
    for (const { r, c } of emptyCells) {
      if (isEmptyAndSatisfiesCondition(state.board, r, c, card.conditions, size)) {
        if (isAreaEmpty(state.board, r, c, size)) {
          const placementId = state.placementIdCounter++;
          for (let dr = 0; dr < size; dr++) {
            for (let dc = 0; dc < size; dc++) {
              state.board[r + dr][c + dc] = {
                cardTypeId: card.id,
                isPlayerPlaced: false,
                growthStage: 0, // 自然発生は常に成長段階0から開始
                originRow: r,
                originCol: c,
                size,
                placementId,
                row: r + dr,
                col: c + dc
              };
            }
          }
          // break; // 同種のMutationでも複数発生できるようにするため削除
        }
      }
    }
  }
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// 履歴管理: ボードの深いコピーを作成してスナップショットを保存
function saveStateSnapshot(state) {
  // 新しいアクションを行う場合、現在のインデックスより後の履歴を削除
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }

  // ボードの深いコピーを作成
  const snapshot = state.board.map(row =>
    row.map(cell => cell ? { ...cell } : null)
  );

  state.history.push({
    board: snapshot,
    placementIdCounter: state.placementIdCounter
  });
  state.historyIndex++;

  // 履歴が長くなりすぎないよう制限（最大50ステップ）
  if (state.history.length > 50) {
    state.history.shift();
    state.historyIndex--;
  }
}

function undo(state) {
  if (state.historyIndex <= 0) return false;

  state.historyIndex--;
  const snapshot = state.history[state.historyIndex];

  // スナップショットからボードを復元
  state.board = snapshot.board.map(row =>
    row.map(cell => cell ? { ...cell } : null)
  );
  state.placementIdCounter = snapshot.placementIdCounter;

  return true;
}

function redo(state) {
  if (state.historyIndex >= state.history.length - 1) return false;

  state.historyIndex++;
  const snapshot = state.history[state.historyIndex];

  // スナップショットからボードを復元
  state.board = snapshot.board.map(row =>
    row.map(cell => cell ? { ...cell } : null)
  );
  state.placementIdCounter = snapshot.placementIdCounter;

  return true;
}

// 初期状態を履歴に保存（ゲーム開始時のみ呼ばれる）
function saveInitialState(state) {
  const snapshot = state.board.map(row =>
    row.map(cell => cell ? { ...cell } : null)
  );

  state.history.push({
    board: snapshot,
    placementIdCounter: state.placementIdCounter
  });
  state.historyIndex = 0;
}

// 設定を読み込み（fetch）
function loadConfig(url) {
  url = url || 'config.json';
  return fetch(url).then(r => {
    if (!r.ok) throw new Error('config.json を読み込めません');
    return r.json();
  });
}

window.Game = {
  BOARD_SIZE,
  loadConfig,
  createGameState,
  calculateScore,
  placeCard,
  destroyCard,
  progress,
  undo,
  redo,
  saveInitialState,
  saveStateSnapshot,
  canUndo(state) { return state.historyIndex > 0; },
  canRedo(state) { return state.historyIndex < state.history.length - 1; },
  getCardTypes(state) { return state.cardTypes; },
  getBoard(state) { return state.board; },
  getScoreParam(state) { return { index: state.scoreParamIndex, name: state.scoreParamName }; }
};
