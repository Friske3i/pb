const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'densest_layouts.json');
const BOARD_SIZE = 10;
const TIMEOUT_MS = 3000; // 3 seconds per T check

let START_TIME = 0;
const resultsCache = {};

console.log('Starting densest layout search (Refactored)...');

// Load config
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Main execution
function main() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
    }

    const results = {};

    for (const mutation of config.mutations) {
        if (mutation.category === 'basecrop') continue;

        console.log(`Processing ${mutation.name} (ID: ${mutation.id})...`);

        const ingredients = getIngredients(mutation);
        if (ingredients.length === 0) {
            console.log(`  Skipping ${mutation.name} (no ingredients).`);
            continue;
        }

        const layout = solveDensestLayout(mutation, ingredients);
        results[mutation.id] = layout;

        console.log(`  Found max count: ${layout.max_count}`);
        // console.log(`  Layout: ${JSON.stringify(layout.layout)}`);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to ${OUTPUT_FILE}`);
}

function getIngredients(mutation) {
    const list = [];
    if (mutation.conditions) {
        for (const cond of mutation.conditions) {
            const materialType = config.mutations.find(m => m.id === cond.id);
            if (materialType) {
                for (let i = 0; i < cond.amount; i++) {
                    list.push({
                        id: cond.id,
                        size: materialType.size || 1
                    });
                }
            } else {
                // Fallback or ignore
            }
        }
    }
    list.sort((a, b) => b.size - a.size);
    return list;
}


function solveDensestLayout(mutation, ingredients) {
    const targetSize = mutation.size;

    // Normalize requirements
    const requirements = {};
    const materialIdsBySize = {};

    for (const item of ingredients) {
        requirements[item.size] = (requirements[item.size] || 0) + 1;
        if (!materialIdsBySize[item.size]) materialIdsBySize[item.size] = item.id;
    }

    const reqList = Object.entries(requirements)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([s, c]) => ({ size: parseInt(s), count: c }));

    const signature = `T${targetSize}_` + reqList.map(r => `S${r.size}x${r.count}`).join('_');

    if (resultsCache[signature]) {
        console.log(`    (Cached result for ${signature})`);
        const cached = resultsCache[signature];
        return remapLayoutIDs(cached, mutation.id, materialIdsBySize);
    }

    console.log(`    Solving: ${signature}`);

    let low = 1;
    let high = Math.floor((BOARD_SIZE * BOARD_SIZE) / (targetSize * targetSize));
    let bestCount = 0;
    let bestLayout = [];

    console.log(`    Range: [${low}, ${high}]`);

    while (low <= high) {
        const t = Math.floor((low + high) / 2);

        const result = tryOptimizeForT(t, targetSize, reqList);

        if (result) {
            console.log(`      T=${t}: PASS`);
            bestCount = t;
            bestLayout = result;
            low = t + 1;
        } else {
            console.log(`      T=${t}: FAIL`);
            high = t - 1;
        }
    }

    const finalRes = { max_count: bestCount, layout: bestLayout };
    resultsCache[signature] = finalRes;
    return remapLayoutIDs(finalRes, mutation.id, materialIdsBySize);
}

function remapLayoutIDs(result, targetId, materialMap) {
    return {
        max_count: result.max_count,
        layout: result.layout.map(p => ({
            ...p,
            id: p.type === 'target' ? targetId : (materialMap[p.size] || p.id)
        }))
    };
}

function canPlaceRect(grid, x, y, size) {
    if (x + size > BOARD_SIZE || y + size > BOARD_SIZE) return false;
    for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
            if (grid[(y + dy) * BOARD_SIZE + (x + dx)] !== 0) return false;
        }
    }
    return true;
}

function placeRect(grid, x, y, size, val) {
    for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
            grid[(y + dy) * BOARD_SIZE + (x + dx)] = val;
        }
    }
}

// Fixed function with proper swap/revert
function optimizeLoop(grid, targets, t, targetSize, reqList) {
    let currentScore = evaluateScore(grid, targets, targetSize, reqList);
    if (currentScore === t) return extractLayout(grid, targets, targetSize, reqList);

    const startTime = Date.now();
    let temp = 1.0;

    while (Date.now() - startTime < 2000) {
        const idx = Math.floor(Math.random() * t);
        const target = targets[idx];
        const oldX = target.x;
        const oldY = target.y;

        // Remove temporarily
        placeRect(grid, oldX, oldY, targetSize, 0);

        // Try new pos
        const nx = Math.floor(Math.random() * BOARD_SIZE);
        const ny = Math.floor(Math.random() * BOARD_SIZE);

        if (canPlaceRect(grid, nx, ny, targetSize)) {
            placeRect(grid, nx, ny, targetSize, 1);
            target.x = nx;
            target.y = ny;

            const newScore = evaluateScore(grid, targets, targetSize, reqList);

            // Minimize UNSATISFIED => Maximize Score
            const delta = newScore - currentScore;

            if (newScore >= currentScore) {
                currentScore = newScore;
                if (currentScore === t) return extractLayout(grid, targets, targetSize, reqList);
            } else {
                // Revert
                placeRect(grid, nx, ny, targetSize, 0);
                placeRect(grid, oldX, oldY, targetSize, 1);
                target.x = oldX;
                target.y = oldY;
            }
        } else {
            // Restore
            placeRect(grid, oldX, oldY, targetSize, 1);
        }

        temp *= 0.9995;
    }
    return null;
}

// Override tryOptimizeForT to use check
function tryOptimizeForT(t, targetSize, reqList) {
    let grid = new Int8Array(BOARD_SIZE * BOARD_SIZE).fill(0);
    const targets = [];

    // Initial: Randomly place T
    let failed = false;
    for (let i = 0; i < t; i++) {
        let placed = false;
        // Try 1000 times
        for (let k = 0; k < 1000; k++) {
            const x = Math.floor(Math.random() * BOARD_SIZE);
            const y = Math.floor(Math.random() * BOARD_SIZE);
            if (canPlaceRect(grid, x, y, targetSize)) {
                placeRect(grid, x, y, targetSize, 1);
                targets.push({ x, y, size: targetSize, type: 'target' });
                placed = true;
                break;
            }
        }
        if (!placed) { failed = true; break; }
    }

    if (failed) return null; // Can't fit

    return optimizeLoop(grid, targets, t, targetSize, reqList);
}


function evaluateScore(grid, targets, targetSize, reqList) {
    // Check if we need complex packing
    const needsPacking = reqList.some(r => r.size > 1);

    if (!needsPacking) {
        // Simple case: Count available size 1 cells
        let satisfied = 0;
        for (const t of targets) {
            let ok = true;
            for (const req of reqList) {
                let found = 0;
                // Scan neighborhood
                const minX = Math.max(0, t.x - 1);
                const maxX = Math.min(BOARD_SIZE - 1, t.x + targetSize);
                const minY = Math.max(0, t.y - 1);
                const maxY = Math.min(BOARD_SIZE - 1, t.y + targetSize);

                for (let ny = minY; ny <= maxY; ny++) {
                    for (let nx = minX; nx <= maxX; nx++) {
                        if (nx >= t.x && nx < t.x + targetSize && ny >= t.y && ny < t.y + targetSize) continue;
                        if (grid[ny * BOARD_SIZE + nx] !== 1) found++;
                    }
                }
                if (found < req.count) { ok = false; break; }
            }
            if (ok) satisfied++;
        }
        return satisfied;
    } else {
        // Complex case: Greedy Packing
        return evaluateWithPacking(grid, targets, targetSize, reqList, false);
    }
}

function evaluateWithPacking(baseGrid, targets, targetSize, reqList, returnLayout) {
    // Clone grid to simulate material placement
    const grid = new Int8Array(baseGrid);
    const layout = returnLayout ? [...targets] : null;

    // Track needs per target
    // Interpret "Count N" as "N Adjacent Cells"
    const targetNeeds = targets.map((t, idx) => {
        return {
            idx: idx,
            t: t,
            // Pre-calculate Expanded Target Rect for fast adjacency check
            expandedT: { x: t.x - 1, y: t.y - 1, size: targetSize + 2 }, // Approximating expansion
            needs: reqList.map(r => ({
                ...r,
                requiredCells: r.count,
                currentCells: 0
            }))
        };
    });

    const sizes = [...new Set(reqList.map(r => r.size))].sort((a, b) => b - a);

    for (const size of sizes) {
        while (true) {
            let bestScore = 0;
            let bestPos = null;
            const materialVal = 10 + size;

            // Iterate all valid positions for 'size'
            for (let y = 0; y <= BOARD_SIZE - size; y++) {
                for (let x = 0; x <= BOARD_SIZE - size; x++) {
                    if (canPlaceRect(grid, x, y, size)) {
                        let score = 0;

                        // Check contribution to targets
                        const matRect = { x: x, y: y, size: size }; // Width/Height = size

                        for (const info of targetNeeds) {
                            const need = info.needs.find(n => n.size === size);
                            if (need && need.currentCells < need.requiredCells) {
                                // Calculate touching cells
                                // Intersection of MaterialRect and ExpandedTargetRect
                                const overlapParams = getIntersectionHeightWidth(matRect, {
                                    x: info.t.x - 1,
                                    y: info.t.y - 1,
                                    w: targetSize + 2,
                                    h: targetSize + 2
                                });

                                const touching = overlapParams.w * overlapParams.h;
                                if (touching > 0) {
                                    const useful = Math.min(touching, need.requiredCells - need.currentCells);
                                    score += useful;
                                }
                            }
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestPos = { x, y };
                        }
                    }
                }
            }

            if (bestScore > 0 && bestPos) {
                // Place it
                placeRect(grid, bestPos.x, bestPos.y, size, materialVal);
                if (returnLayout) {
                    layout.push({ x: bestPos.x, y: bestPos.y, size, type: 'material', id: 'unknown' });
                }

                // Update needs
                const matRect = { x: bestPos.x, y: bestPos.y, size: size };
                for (const info of targetNeeds) {
                    const need = info.needs.find(n => n.size === size);
                    if (need && need.currentCells < need.requiredCells) {
                        const overlapParams = getIntersectionHeightWidth(matRect, {
                            x: info.t.x - 1,
                            y: info.t.y - 1,
                            w: targetSize + 2,
                            h: targetSize + 2
                        });
                        const touching = overlapParams.w * overlapParams.h;
                        if (touching > 0) {
                            need.currentCells += touching;
                        }
                    }
                }
            } else {
                break;
            }
        }
    }

    if (returnLayout) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                if (grid[y * BOARD_SIZE + x] === 0) {
                    layout.push({ x, y, size: 1, type: 'material', id: 'unknown' });
                }
            }
        }
    }

    let satisfied = 0;
    for (const info of targetNeeds) {
        if (info.needs.every(n => n.currentCells >= n.requiredCells)) {
            satisfied++;
        }
    }

    return returnLayout ? layout : satisfied;
}

function getIntersectionHeightWidth(r1, r2) {
    // r1 is square {x,y,size}
    // r2 is rect {x,y,w,h}
    const r1w = r1.size;
    const r1h = r1.size;

    const xOverlap = Math.max(0, Math.min(r1.x + r1w, r2.x + r2.w) - Math.max(r1.x, r2.x));
    const yOverlap = Math.max(0, Math.min(r1.y + r1h, r2.y + r2.h) - Math.max(r1.y, r2.y));
    return { w: xOverlap, h: yOverlap };
}

function areRectsAdjacent(r1, r2) {
    // Check if they touch but don't overlap (overlap prevented by grid check)
    // Actually we just need distance 0.
    // Expand r1 by 1 and check intersect

    const xOverlap = Math.max(r1.x - 1, r2.x) < Math.min(r1.x + r1.size + 1, r2.x + r2.size);
    const yOverlap = Math.max(r1.y - 1, r2.y) < Math.min(r1.y + r1.size + 1, r2.y + r2.size);

    if (!xOverlap || !yOverlap) return false;

    // Exclude overlap (shouldn't happen if valid placement)
    // But r1 and r2 are disjoint.
    return true;
}



function extractLayout(grid, targets, targetSize, reqList) {
    // Re-run the packing logic to get the final layout with materials
    return evaluateWithPacking(grid, targets, targetSize, reqList, true);
}

main();
