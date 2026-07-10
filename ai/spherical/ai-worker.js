// AI Worker for Spherical Reversi
// Handles AI move calculation off the main thread

const PLAYER_BLACK = 1;
const PLAYER_WHITE = 2;

// Store tile positions globally
let tilePositions = null;

// Listen for messages from main thread
self.addEventListener('message', (e) => {
    const { gameState, difficulty, currentPlayer } = e.data;

    // Store tile positions (sent once at initialization, then reused)
    if (gameState.tilePositions) {
        tilePositions = gameState.tilePositions;
        return; // Just storing positions, no move to make
    }

    // Reconstruct the board Map from the serialized data
    const board = new Map(gameState.board);
    const adjacency = new Map(gameState.adjacency);
    const validMoves = new Set(gameState.validMoves);

    if (validMoves.size === 0) {
        self.postMessage({ action: 'pass' });
        return;
    }

    let selectedMove;

    switch (difficulty) {
        case 'easy':
            selectedMove = getEasyMove(validMoves);
            break;
        case 'medium':
            selectedMove = getMediumMove(validMoves, board, adjacency, currentPlayer);
            break;
        case 'hard':
            selectedMove = getHardMove(validMoves, board, adjacency, currentPlayer, gameState.tilesCount);
            break;
    }

    self.postMessage({ action: 'move', tileIndex: selectedMove });
});

function getEasyMove(validMoves) {
    const moves = Array.from(validMoves);
    return moves[Math.floor(Math.random() * moves.length)];
}

function getMediumMove(validMoves, board, adjacency, currentPlayer) {
    let bestMove = null;
    let maxFlips = -1;

    validMoves.forEach(move => {
        const flips = getFlippedPieces(move, currentPlayer, board, adjacency).length;
        if (flips > maxFlips) {
            maxFlips = flips;
            bestMove = move;
        }
    });

    return bestMove;
}

function getHardMove(validMoves, board, adjacency, currentPlayer, tilesCount) {
    let bestMove = null;
    let bestScore = -Infinity;

    validMoves.forEach(move => {
        const score = minimaxScore(
            move,
            3,
            -Infinity,
            Infinity,
            true,
            board,
            adjacency,
            currentPlayer,
            tilesCount
        );
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    });

    return bestMove;
}

function minimaxScore(move, depth, alpha, beta, isMaximizing, board, adjacency, currentPlayer, tilesCount) {
    if (depth === 0) {
        return evaluateBoard(board, adjacency, currentPlayer, tilesCount);
    }

    // Simulate the move
    const newBoard = new Map(board);
    newBoard.set(move, currentPlayer);
    const flipped = getFlippedPieces(move, currentPlayer, newBoard, adjacency);
    flipped.forEach(index => newBoard.set(index, currentPlayer));

    // Switch player
    const nextPlayer = currentPlayer === PLAYER_BLACK ? PLAYER_WHITE : PLAYER_BLACK;
    const validMoves = getValidMoves(newBoard, adjacency, nextPlayer, tilesCount);

    let score;
    if (validMoves.size === 0) {
        score = evaluateBoard(newBoard, adjacency, currentPlayer, tilesCount);
    } else if (isMaximizing) {
        score = -Infinity;
        for (let nextMove of validMoves) {
            score = Math.max(
                score,
                minimaxScore(nextMove, depth - 1, alpha, beta, false, newBoard, adjacency, nextPlayer, tilesCount)
            );
            alpha = Math.max(alpha, score);
            if (beta <= alpha) break;
        }
    } else {
        score = Infinity;
        for (let nextMove of validMoves) {
            score = Math.min(
                score,
                minimaxScore(nextMove, depth - 1, alpha, beta, true, newBoard, adjacency, nextPlayer, tilesCount)
            );
            beta = Math.min(beta, score);
            if (beta <= alpha) break;
        }
    }

    return score;
}

function evaluateBoard(board, adjacency, aiPlayer, tilesCount) {
    const scores = getScores(board);

    let score = 0;

    // Piece count difference
    if (aiPlayer === PLAYER_BLACK) {
        score += (scores.black - scores.white) * 10;
    } else {
        score += (scores.white - scores.black) * 10;
    }

    // Corner bonus
    const corners = getCornerTiles(adjacency, tilesCount);
    corners.forEach(corner => {
        const piece = board.get(corner);
        if (piece === aiPlayer) {
            score += 50;
        } else if (piece !== undefined) {
            score -= 50;
        }
    });

    // Mobility
    const validMoves = getValidMoves(board, adjacency, aiPlayer, tilesCount);
    score += validMoves.size * 5;

    return score;
}

function getScores(board) {
    let black = 0, white = 0;
    board.forEach(player => {
        if (player === PLAYER_BLACK) black++;
        if (player === PLAYER_WHITE) white++;
    });
    return { black, white };
}

function getCornerTiles(adjacency, tilesCount) {
    const distances = [];
    for (let i = 0; i < tilesCount; i++) {
        distances.push({
            index: i,
            neighbors: (adjacency.get(i) || []).length
        });
    }

    distances.sort((a, b) => a.neighbors - b.neighbors);
    return distances.slice(0, 8).map(d => d.index);
}

function getValidMoves(board, adjacency, currentPlayer, tilesCount) {
    const validMoves = new Set();

    for (let i = 0; i < tilesCount; i++) {
        if (board.get(i) === undefined) {
            if (getFlippedPieces(i, currentPlayer, board, adjacency).length > 0) {
                validMoves.add(i);
            }
        }
    }

    return validMoves;
}

function getFlippedPieces(tileIndex, player, board, adjacency) {
    const flipped = [];
    const opponent = player === PLAYER_BLACK ? PLAYER_WHITE : PLAYER_BLACK;
    const neighbors = adjacency.get(tileIndex) || [];

    neighbors.forEach(startNeighbor => {
        if (board.get(startNeighbor) === opponent) {
            const tempFlipped = [startNeighbor];
            const direction = getDirection(tileIndex, startNeighbor, adjacency);
            const visited = new Set([tileIndex, startNeighbor]);

            let current = startNeighbor;
            let iterations = 0;
            const maxIterations = 100; // Safety limit

            while (iterations++ < maxIterations) {
                const next = getNextInDirection(current, direction, adjacency);
                if (next === -1) break;
                if (visited.has(next)) break; // Prevent loops

                visited.add(next);

                const piece = board.get(next);
                if (piece === undefined) break;
                if (piece === player) {
                    flipped.push(...tempFlipped);
                    break;
                }
                if (piece === opponent) {
                    tempFlipped.push(next);
                    current = next;
                }
            }
        }
    });

    return flipped;
}

function getDirection(from, to, adjacency) {
    if (!tilePositions) return { from, to };

    const fromPos = tilePositions[from];
    const toPos = tilePositions[to];

    // Calculate direction vector
    return {
        from,
        to,
        dx: toPos.x - fromPos.x,
        dy: toPos.y - fromPos.y,
        dz: toPos.z - fromPos.z
    };
}

function getNextInDirection(current, direction, adjacency) {
    const neighbors = adjacency.get(current) || [];

    if (!tilePositions || !direction.dx) {
        // Fallback to simple adjacency-based approach
        return neighbors.find(n => n !== direction.from) ?? -1;
    }

    const currentPos = tilePositions[current];

    // Normalize direction
    const len = Math.sqrt(direction.dx ** 2 + direction.dy ** 2 + direction.dz ** 2);
    const normDx = direction.dx / len;
    const normDy = direction.dy / len;
    const normDz = direction.dz / len;

    let bestMatch = -1;
    let bestDot = -1;

    neighbors.forEach(neighbor => {
        const neighborPos = tilePositions[neighbor];
        const neighborDx = neighborPos.x - currentPos.x;
        const neighborDy = neighborPos.y - currentPos.y;
        const neighborDz = neighborPos.z - currentPos.z;

        const neighborLen = Math.sqrt(neighborDx ** 2 + neighborDy ** 2 + neighborDz ** 2);
        const neighborNormDx = neighborDx / neighborLen;
        const neighborNormDy = neighborDy / neighborLen;
        const neighborNormDz = neighborDz / neighborLen;

        // Dot product to find most aligned direction
        const dot = normDx * neighborNormDx + normDy * neighborNormDy + normDz * neighborNormDz;

        if (dot > bestDot && dot > 0.5) {
            bestDot = dot;
            bestMatch = neighbor;
        }
    });

    return bestMatch;
}
