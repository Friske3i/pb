/**
 * Mutation Planner - 10x10 格子カードゲーム
 * 設定は config.json から参照（スコアパラメータ・周辺条件・カード定義）
 */

const BOARD_SIZE = 10;

// config.mutations を内部用に正規化: params と出現条件(conditions)を保持
function normalizeMutation(mutation, scoreParams, id) {
  const params = scoreParams.map(p => mutation.scores?.[p] ?? mutation[p] ?? 0);
  const conditions = mutation.conditions ?? mutation.spawnCondition?.conditions ?? [];
  const category = mutation.category ?? 'basecrop'; // デフォルトはbasecrop
  const maxGrowthStage = mutation.maxGrowthStage ?? 1; // デフォルトは1（即座に成長完了）
  return {
    id: id ?? mutation.id,
    name: mutation.name,
    size: mutation.size,
    params,
    conditions,
    image: mutation.image,
    category,
    maxGrowthStage,
    specialEffect: mutation.specialEffect
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
    const id = cell.mutationId;
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

// config は config.json の内容（scoreParams, spawnCondition, mutations）
function createGameState(config) {
  const scoreParams = config.scoreParams || [];
  const mutationTypes = (config.mutations || []).map((mutation, i) => normalizeMutation(mutation, scoreParams, i));
  const scoreParamIndex = 0; // Wheat固定
  return {
    board: createEmptyBoard(),
    mutationTypes,
    scoreParamIndex,
    scoreParamName: scoreParams[scoreParamIndex] || '—',
    scoreParams,
    scoreParamNames: config.scoreParamNames || {},
    selectedMutationId: null,
    placementIdCounter: 0,
    simulationMode: false, // シミュレーションモード（成長段階システム）
    evaluationMode: false, // 評価モード（状態無視でスコア計算）
    history: [],
    historyIndex: -1,
    // Advanced Score Factors
    fortune: 0,
    chips: 0,
    ghUpgrade: 0, // 0-9
    uniqueBuff: 0, // 0-12
    additiveBuff: 1,
    multiBuff: 1
  };
}

// 個別のセルのスコアを計算
function calculateCellScore(cell, mutation, scoreParamIndex, simulationMode, evaluationMode) {
  let baseScore = mutation.params[scoreParamIndex] ?? 0;

  if (!simulationMode && !evaluationMode) {
    if (cell.isPlayerPlaced) return 0;
    return baseScore;
  }

  // Simulation Mode

  // Player placed mutated items don't score (uncollectable)
  // Evaluation Mode: Ignore this
  if (cell.isPlayerPlaced && mutation.category === 'mutated' && !evaluationMode) return 0;

  const growthStage = cell.growthStage || 0;

  // Special Effects
  if (mutation.specialEffect === 'magic_jerrybean') {
    const multiplier = Math.floor(growthStage / 15);
    return baseScore * multiplier;
  }

  // Glasscorn: 7,8 are fully grown (yields score). Max is 9 (loops back to 1).
  if (mutation.specialEffect === 'glasscorn') {
    if (growthStage !== 7 && growthStage !== 8 && !evaluationMode) return 0;
    return baseScore;
  }

  // Normal crops
  const maxGrowthStage = mutation.maxGrowthStage !== undefined ? mutation.maxGrowthStage : 1;
  // If maxGrowthStage is 0, it's always fully grown
  if (maxGrowthStage > 0 && growthStage < maxGrowthStage && !evaluationMode) return 0;

  return baseScore;
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

      const mutation = state.mutationTypes[cell.mutationId];
      total += calculateCellScore(cell, mutation, state.scoreParamIndex, state.simulationMode, state.evaluationMode);
    }
  }

  // total is simply the sum of individual cell scores (which already include multipliers if any)
  // However, wait. calculateCellScore ALREADY applies multipliers for Magic Jerrybean. 
  // But here we are applying GLOBAL multipliers (Buffs, Fortune, Chips).
  // So 'total' so far is the "Base Yield" from crops (including their internal multipliers like Jerrybean).

  const baseYield = total;

  // Apply Advanced Factors
  // Final = Base * Additive * (1 + Chip/100) * (1 + Fortune/100) * Multi

  // Ensure default values if undefined (for old states/saves compatibility)
  const additiveBase = state.additiveBuff ?? 1;
  const chipFactor = 1 + ((state.chips ?? 0) / 100);
  const fortuneFactor = 1 + ((state.fortune ?? 0) / 100);

  // GH Upgrade: 0-9 (NOW ADDITIVE)
  // 0:0%, 1:2% ... 9:20%
  const ghLvl = state.ghUpgrade || 0;
  let ghPercent = 0;
  if (ghLvl >= 9) ghPercent = 20;
  else ghPercent = ghLvl * 2;

  // Additive total = base(1) + ghUpgrade
  const additiveTotal = additiveBase + (ghPercent / 100);

  // Unique Buff: 0-12 (Multi)
  // 0-36%, so 3% per level? 
  // 12 * 3 = 36. So yes, 3% step.
  const uniqueLvl = state.uniqueBuff || 0;
  let uniquePercent = uniqueLvl * 3;
  if (uniquePercent > 36) uniquePercent = 36;
  const uniqueFactor = 1 + (uniquePercent / 100);

  const multiBase = state.multiBuff ?? 1;

  // Final = Base * (AdditiveTotal) * Chip * Fortune * Unique * MultiBase
  const finalYield = Math.floor(baseYield * additiveTotal * chipFactor * fortuneFactor * uniqueFactor * multiBase);

  return {
    base: baseYield,
    final: finalYield
  };
}

function placeMutation(state, row, col, mutationId) {
  const mutation = state.mutationTypes[mutationId];
  if (!mutation) return false;
  const size = mutation.size;

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
  overlapping.forEach(pos => destroyMutationInternal(state, pos.row, pos.col));

  // 成長段階の初期値を決定（0から始まる）
  let growthStage;
  if (state.simulationMode) {
    // シミュレーションモード: カテゴリに応じて初期値を設定
    growthStage = (mutation.category === 'mutated') ? mutation.maxGrowthStage : 0;
  } else {
    // 非シミュレーションモード: 常に最大値（成長完了状態）
    growthStage = mutation.maxGrowthStage;
  }

  // Magic Jerrybean: Always start at stage 120 (8x multiplier) when player placed
  if (mutation.specialEffect === 'magic_jerrybean') {
    growthStage = 120;
  }

  const placementId = state.placementIdCounter++;
  for (let r = row; r < row + size; r++) {
    for (let c = col; c < col + size; c++) {
      state.board[r][c] = {
        mutationId,
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

function destroyMutation(state, row, col) {
  const cell = state.board[row][col];
  if (!cell) return false;

  destroyMutationInternal(state, row, col);
  return true;
}

// 内部用: 履歴を保存せずにカードを破壊
function destroyMutationInternal(state, row, col) {
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
          const mutation = state.mutationTypes[cell.mutationId];
          // Glasscorn: maxGrowthStage (9) まで育ち、次は1に戻る
          if (mutation.specialEffect === 'glasscorn') {
            if (cell.growthStage >= mutation.maxGrowthStage - 1) { // 修正: 8->9ループの修正反映
              cell.growthStage = 1;
            } else {
              cell.growthStage++;
            }
          } else {
            // 通常: 成長段階が最大値未満なら1増やす
            if (cell.growthStage < mutation.maxGrowthStage) {
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

  // 各空きセルに対して、発生条件を満たすMutationを探す
  for (const { r, c } of emptyCells) {
    // 処理中に埋まってしまった場合はスキップ
    if (state.board[r][c] !== null) continue;

    const candidates = [];

    for (const mutation of state.mutationTypes) {
      if (!mutation.conditions || mutation.conditions.length === 0) continue;

      const size = mutation.size;
      // まず条件と空き領域チェック
      if (isEmptyAndSatisfiesCondition(state.board, r, c, mutation.conditions, size)) {
        if (isAreaEmpty(state.board, r, c, size)) {
          candidates.push(mutation);
        }
      }
    }

    if (candidates.length === 0) continue;

    // IDの降順（高いID優先）でソート
    candidates.sort((a, b) => b.id - a.id);
    const bestMutation = candidates[0];

    // 確率判定
    // Simulation Mode: 25%
    // Non-Simulation Mode: 100%
    if (state.simulationMode) {
      if (Math.random() > 0.25) continue;
    }

    // 配置実行
    const size = bestMutation.size;
    const placementId = state.placementIdCounter++;
    for (let dr = 0; dr < size; dr++) {
      for (let dc = 0; dc < size; dc++) {
        state.board[r + dr][c + dc] = {
          mutationId: bestMutation.id,
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
  calculateCellScore,
  placeMutation,
  destroyMutation,
  progress,
  undo,
  redo,
  saveInitialState,
  saveStateSnapshot,
  canUndo(state) { return state.historyIndex > 0; },
  canRedo(state) { return state.historyIndex < state.history.length - 1; },
  getMutationTypes(state) { return state.mutationTypes; },
  getBoard(state) { return state.board; },
  getScoreParam(state) { return { index: state.scoreParamIndex, name: state.scoreParamName }; },

  // 盤面を文字列化 (Run-Length Encoded Binary -> Base64)
  // Format: [Value, Count], [Value, Count]... where Value=255 means empty/skip
  // Value 0-127: Spawned Mutation ID
  // Value 128-254: Player Placed Mutation ID (ID + 128)
  exportBoard(state) {
    const flat = [];
    const boardSize = window.Game.BOARD_SIZE;

    // 1. Flatten board to array of IDs (255 for empty/non-origin)
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const cell = state.board[r][c];
        if (!cell) {
          flat.push(255); // Empty
        } else if (cell.originRow === r && cell.originCol === c) {
          // Origin: check if ID fits in byte
          const id = cell.mutationId;
          if (id >= 127) {
            console.warn('Mutation ID too large for byte encoding with flag:', id);
            flat.push(255); // Fallback to empty to avoid corruption
          } else {
            let val = id;
            // プレイヤー設置フラグをMSB(0x80)に格納
            if (cell.isPlayerPlaced) {
              val |= 0x80;
            }
            flat.push(val);
          }
        } else {
          flat.push(255); // Occupied by neighbor (skip)
        }
      }
    }

    // 2. Run-Length Encoding
    const rle = [];
    if (flat.length > 0) {
      let currentVal = flat[0];
      let count = 1;

      for (let i = 1; i < flat.length; i++) {
        // Max count per byte is 255
        if (flat[i] === currentVal && count < 255) {
          count++;
        } else {
          rle.push(currentVal, count);
          currentVal = flat[i];
          count = 1;
        }
      }
      rle.push(currentVal, count);
    }

    // 3. Convert to Binary String
    // rle array contains 0-255 integers.
    let binary = '';
    const len = rle.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(rle[i]);
    }

    // 4. Base64 Encode
    return btoa(binary);
  },

  // 文字列から盤面を読み込む
  importBoard(state, encodedStr) {
    try {
      // 1. Decode Base64 to Binary String
      const binary = atob(encodedStr);

      // 2. Decode RLE to Flat Array
      const flat = [];
      for (let i = 0; i < binary.length; i += 2) {
        if (i + 1 >= binary.length) break;
        const val = binary.charCodeAt(i);
        const count = binary.charCodeAt(i + 1);

        for (let k = 0; k < count; k++) {
          flat.push(val);
        }
      }

      const boardSize = window.Game.BOARD_SIZE;
      if (flat.length !== boardSize * boardSize) {
        // Warning: length mismatch, might be resize or corruption.
        // We'll try to load as much as possible or fail.
        // Let's assume fail for safety if significantly off, but lenient if just last empty missing?
        // RLE should be exact.
        if (flat.length < boardSize * boardSize) {
          // Pad with empty
          while (flat.length < boardSize * boardSize) flat.push(255);
        }
      }

      // 3. Reconstruct Board
      state.board = createEmptyBoard();
      state.placementIdCounter = 0;

      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
          const idx = r * boardSize + c;
          const val = flat[idx];

          if (val !== 255) {
            // MSBをチェックしてプレイヤー設置フラグを取得
            const isPlayerPlaced = (val & 0x80) !== 0;
            const id = val & 0x7F;

            // Try to place
            if (state.mutationTypes[id]) {
              placeMutation(state, r, c, id);

              // placeMutationはデフォルトでisPlayerPlaced=trueにするため、
              // 必要なら上書きする (falseの場合、または明示的にtrueの場合も念のため)
              // placeMutationで生成されたセル(サイズ分)全て更新する
              const cell = state.board[r][c];
              if (cell) {
                const size = cell.size;
                for (let dr = 0; dr < size; dr++) {
                  for (let dc = 0; dc < size; dc++) {
                    if (state.board[r + dr] && state.board[r + dr][c + dc]) {
                      state.board[r + dr][c + dc].isPlayerPlaced = isPlayerPlaced;
                    }
                  }
                }
              }
            }
          }
        }
      }

      saveInitialState(state);
      return true;
    } catch (e) {
      console.error('Import failed', e);
      return false;
    }
  }
};
