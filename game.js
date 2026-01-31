/**
 * Mutation Planner - 10x10 格子カードゲーム
 * 設定は config.json から参照（スコアパラメータ・周辺条件・カード定義）
 */

const BOARD_SIZE = 10;

// config.cards を内部用に正規化: params と出現条件(conditions)を保持
function normalizeCard(card, scoreParams, id) {
  const params = scoreParams.map(p => card.scores?.[p] ?? card[p] ?? 0);
  const conditions = card.conditions ?? card.spawnCondition?.conditions ?? [];
  return { id: id ?? card.id, name: card.name, size: card.size, params, conditions };
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
    placementIdCounter: 0
  };
}

// スコア計算: 盤面上の「出現カード」のみ。サイズ2以上も全体で1枚として1回だけ加算
function calculateScore(state) {
  let total = 0;
  const counted = new Set();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = state.board[r][c];
      if (!cell || cell.isPlayerPlaced) continue;
      const key = `${cell.originRow},${cell.originCol}`;
      if (counted.has(key)) continue;
      counted.add(key);
      const card = state.cardTypes[cell.cardTypeId];
      total += card.params[state.scoreParamIndex] ?? 0;
    }
  }
  return total;
}

function placeCard(state, row, col, cardTypeId) {
  const card = state.cardTypes[cardTypeId];
  if (!card) return false;
  const size = card.size;
  if (!isAreaEmpty(state.board, row, col, size)) return false;
  const placementId = state.placementIdCounter++;
  for (let r = row; r < row + size; r++) {
    for (let c = col; c < col + size; c++) {
      state.board[r][c] = {
        cardTypeId,
        isPlayerPlaced: true,
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
  const { originRow, originCol, size } = cell;
  for (let r = originRow; r < originRow + size; r++) {
    for (let c = originCol; c < originCol + size; c++) {
      state.board[r][c] = null;
    }
  }
  return true;
}

function progress(state) {
  const emptyCells = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (state.board[r][c] === null) emptyCells.push({ r, c });
    }
  }
  shuffle(emptyCells);
  for (const { r, c } of emptyCells) {
    if (state.board[r][c] !== null) continue;

    // 条件を満たすカードを探す
    const candidateCards = [];
    for (const card of state.cardTypes) {
      const size = card.size;
      if (!isAreaEmpty(state.board, r, c, size)) continue;
      const conditions = card.conditions || [];
      if (isEmptyAndSatisfiesCondition(state.board, r, c, conditions, size)) {
        candidateCards.push(card);
      }
    }

    // 候補がなければ次のマスへ
    if (candidateCards.length === 0) continue;

    // 候補からランダムに1枚選んで配置
    const card = candidateCards[Math.floor(Math.random() * candidateCards.length)];
    const size = card.size;
    const placementId = state.placementIdCounter++;
    for (let rr = r; rr < r + size; rr++) {
      for (let cc = c; cc < c + size; cc++) {
        state.board[rr][cc] = {
          cardTypeId: card.id,
          isPlayerPlaced: false,
          originRow: r,
          originCol: c,
          size,
          placementId,
          row: rr,
          col: cc
        };
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
  getCardTypes(state) { return state.cardTypes; },
  getBoard(state) { return state.board; },
  getScoreParam(state) { return { index: state.scoreParamIndex, name: state.scoreParamName }; }
};
