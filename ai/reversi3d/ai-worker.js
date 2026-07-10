// AI Worker - runs AI computations in a separate thread

// ========== MOVE ==========
class Move {
    constructor(x, y, z, player, flippedPieces = []) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.player = player;
        this.flippedPieces = flippedPieces;
    }

    apply(board) {
        board[this.x][this.y][this.z] = this.player;
        for (const pos of this.flippedPieces) {
            board[pos.x][pos.y][pos.z] = this.player;
        }
    }
}

// ========== RULES ==========
class Rules {
    static DIRECTIONS = [
        [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
        [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
        [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
        [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
        [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
        [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
    ];

    static isValidPosition(x, y, z) {
        return x >= 0 && x < 8 && y >= 0 && y < 8 && z >= 0 && z < 8;
    }

    static findFlippablePieces(board, x, y, z, player) {
        const opponent = player === 1 ? 2 : 1;
        let allFlippable = [];

        for (const [dx, dy, dz] of Rules.DIRECTIONS) {
            let flippableInDir = [];
            let nx = x + dx, ny = y + dy, nz = z + dz;

            while (Rules.isValidPosition(nx, ny, nz)) {
                const cell = board[nx][ny][nz];
                if (cell === 0) break;
                if (cell === opponent) {
                    flippableInDir.push({ x: nx, y: ny, z: nz });
                } else if (cell === player) {
                    allFlippable.push(...flippableInDir);
                    break;
                }
                nx += dx; ny += dy; nz += dz;
            }
        }
        return allFlippable;
    }

    static getLegalMoves(board, player) {
        const legalMoves = [];
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                for (let z = 0; z < 8; z++) {
                    if (board[x][y][z] === 0) {
                        const flippable = Rules.findFlippablePieces(board, x, y, z, player);
                        if (flippable.length > 0) {
                            legalMoves.push(new Move(x, y, z, player, flippable));
                        }
                    }
                }
            }
        }
        return legalMoves;
    }

    static getPieceCount(board, player) {
        let count = 0;
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                for (let z = 0; z < 8; z++) {
                    if (board[x][y][z] === player) count++;
                }
            }
        }
        return count;
    }
}

// ========== AI PLAYER ==========
class AIPlayer {
    constructor(player, difficulty = 2) {
        this.player = player;
        this.opponent = player === 1 ? 2 : 1;
        this.difficulty = difficulty;
    }

    selectMove(board) {
        const legalMoves = Rules.getLegalMoves(board, this.player);
        if (legalMoves.length === 0) return null;
        if (legalMoves.length === 1) return legalMoves[0];

        let bestMove = null;
        let bestScore = -Infinity;

        for (const move of legalMoves) {
            const testBoard = this.cloneBoard(board);
            move.apply(testBoard);
            const score = this.minimax(testBoard, this.difficulty, -Infinity, Infinity, false);
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        return bestMove;
    }

    minimax(board, depth, alpha, beta, maximizing) {
        if (depth === 0) {
            return this.evaluateBoard(board);
        }

        const player = maximizing ? this.player : this.opponent;
        const legalMoves = Rules.getLegalMoves(board, player);

        if (legalMoves.length === 0) {
            return this.minimax(board, depth - 1, alpha, beta, !maximizing);
        }

        if (maximizing) {
            let maxEval = -Infinity;
            for (const move of legalMoves) {
                const newBoard = this.cloneBoard(board);
                move.apply(newBoard);
                const evalScore = this.minimax(newBoard, depth - 1, alpha, beta, false);
                maxEval = Math.max(maxEval, evalScore);
                alpha = Math.max(alpha, evalScore);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of legalMoves) {
                const newBoard = this.cloneBoard(board);
                move.apply(newBoard);
                const evalScore = this.minimax(newBoard, depth - 1, alpha, beta, true);
                minEval = Math.min(minEval, evalScore);
                beta = Math.min(beta, evalScore);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    evaluateBoard(board) {
        let score = 0;
        score += (Rules.getPieceCount(board, this.player) - Rules.getPieceCount(board, this.opponent));

        const corners = [[0,0,0], [0,0,7], [0,7,0], [0,7,7], [7,0,0], [7,0,7], [7,7,0], [7,7,7]];
        for (const [x, y, z] of corners) {
            const cell = board[x][y][z];
            if (cell === this.player) score += 100;
            if (cell === this.opponent) score -= 100;
        }

        const myMoves = Rules.getLegalMoves(board, this.player).length;
        const oppMoves = Rules.getLegalMoves(board, this.opponent).length;
        score += (myMoves - oppMoves) * 5;

        return score;
    }

    cloneBoard(board) {
        return board.map(plane => plane.map(row => row.slice()));
    }
}

// Listen for messages from main thread
self.addEventListener('message', (e) => {
    const { board, player, difficulty } = e.data;

    const ai = new AIPlayer(player, difficulty);
    const move = ai.selectMove(board);

    // Send result back to main thread
    self.postMessage({ move });
});
