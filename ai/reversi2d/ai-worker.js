// AI Worker - Runs AI calculations on a separate thread

const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
];

function getPiece(board, x, y) {
    return board.get(`${x},${y}`) || null;
}

function getFlippedPieces(board, x, y, color) {
    const flipped = [];
    const opponent = color === 'black' ? 'white' : 'black';

    for (let [dx, dy] of directions) {
        const piecesToFlip = [];
        let nx = x + dx;
        let ny = y + dy;

        while (getPiece(board, nx, ny) === opponent) {
            piecesToFlip.push([nx, ny]);
            nx += dx;
            ny += dy;
        }

        if (piecesToFlip.length > 0 && getPiece(board, nx, ny) === color) {
            flipped.push(...piecesToFlip);
        }
    }

    return flipped;
}

function isValidMove(board, x, y, color) {
    if (getPiece(board, x, y) !== null) {
        return false;
    }
    return getFlippedPieces(board, x, y, color).length > 0;
}

function getBoardBounds(board) {
    if (board.size === 0) {
        return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let key of board.keys()) {
        const [x, y] = key.split(',').map(Number);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }

    return {
        minX: minX - 1,
        maxX: maxX + 1,
        minY: minY - 1,
        maxY: maxY + 1
    };
}

function getAllValidMoves(board, color) {
    const validMoves = [];
    const bounds = getBoardBounds(board);

    for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            if (isValidMove(board, x, y, color)) {
                validMoves.push([x, y]);
            }
        }
    }

    return validMoves;
}

function calculateBestMove(board, color) {
    const validMoves = getAllValidMoves(board, color);

    if (validMoves.length === 0) {
        return null;
    }

    // Greedy strategy: choose move that flips the most pieces
    let bestMove = null;
    let maxFlips = -1;

    for (let [x, y] of validMoves) {
        const flips = getFlippedPieces(board, x, y, color).length;
        if (flips > maxFlips) {
            maxFlips = flips;
            bestMove = [x, y];
        }
    }

    return bestMove;
}

// Listen for messages from main thread
self.addEventListener('message', (e) => {
    const { type, boardData, color } = e.data;

    if (type === 'calculateMove') {
        // Convert plain object back to Map
        const board = new Map(Object.entries(boardData));

        // Calculate best move
        const move = calculateBestMove(board, color);

        // Send result back to main thread
        self.postMessage({
            type: 'moveCalculated',
            move: move
        });
    }
});
