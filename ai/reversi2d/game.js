class InfiniteReversi {
    constructor() {
        this.board = new Map();
        this.currentPlayer = 'black';
        this.gameMode = 'pvp';
        this.history = [];
        this.directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];

        // Initialize AI Web Worker
        this.aiWorker = new Worker('ai-worker.js');
        this.setupWorkerListener();

        this.initGame();
        this.setupEventListeners();
    }

    initGame() {
        this.board.clear();
        this.history = [];

        // Initial setup: 4 pieces in the center
        this.setPiece(0, 0, 'white');
        this.setPiece(1, 1, 'white');
        this.setPiece(0, 1, 'black');
        this.setPiece(1, 0, 'black');

        this.currentPlayer = 'black';
        this.render();
        this.updateGameInfo();
    }

    setPiece(x, y, color) {
        this.board.set(`${x},${y}`, color);
    }

    getPiece(x, y) {
        return this.board.get(`${x},${y}`) || null;
    }

    getBoardBounds() {
        if (this.board.size === 0) {
            return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (let key of this.board.keys()) {
            const [x, y] = key.split(',').map(Number);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }

        // Add padding to show empty cells around pieces
        return {
            minX: minX - 1,
            maxX: maxX + 1,
            minY: minY - 1,
            maxY: maxY + 1
        };
    }

    isValidMove(x, y, color) {
        if (this.getPiece(x, y) !== null) {
            return false;
        }

        return this.getFlippedPieces(x, y, color).length > 0;
    }

    getFlippedPieces(x, y, color) {
        const flipped = [];
        const opponent = color === 'black' ? 'white' : 'black';

        for (let [dx, dy] of this.directions) {
            const piecesToFlip = [];
            let nx = x + dx;
            let ny = y + dy;

            // Look for opponent pieces in this direction
            while (this.getPiece(nx, ny) === opponent) {
                piecesToFlip.push([nx, ny]);
                nx += dx;
                ny += dy;
            }

            // If we found opponent pieces and ended on our color, this direction is valid
            if (piecesToFlip.length > 0 && this.getPiece(nx, ny) === color) {
                flipped.push(...piecesToFlip);
            }
        }

        return flipped;
    }

    getAllValidMoves(color) {
        const validMoves = [];
        const bounds = this.getBoardBounds();

        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                if (this.isValidMove(x, y, color)) {
                    validMoves.push([x, y]);
                }
            }
        }

        return validMoves;
    }

    makeMove(x, y, color, saveHistory = true) {
        if (!this.isValidMove(x, y, color)) {
            return false;
        }

        if (saveHistory) {
            // Save current state for undo
            this.history.push({
                board: new Map(this.board),
                player: this.currentPlayer
            });
        }

        // Place the piece
        this.setPiece(x, y, color);

        // Flip pieces
        const flipped = this.getFlippedPieces(x, y, color);
        for (let [fx, fy] of flipped) {
            this.setPiece(fx, fy, color);
        }

        return true;
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
    }

    getScore() {
        let black = 0, white = 0;
        for (let color of this.board.values()) {
            if (color === 'black') black++;
            else white++;
        }
        return { black, white };
    }

    checkGameOver() {
        const blackMoves = this.getAllValidMoves('black');
        const whiteMoves = this.getAllValidMoves('white');

        if (blackMoves.length === 0 && whiteMoves.length === 0) {
            const score = this.getScore();
            if (score.black > score.white) {
                return 'Black wins!';
            } else if (score.white > score.black) {
                return 'White wins!';
            } else {
                return 'Draw!';
            }
        }

        return null;
    }

    undo() {
        if (this.history.length === 0) {
            return;
        }

        const lastState = this.history.pop();
        this.board = lastState.board;
        this.currentPlayer = lastState.player;
        this.render();
        this.updateGameInfo();
    }

    setupWorkerListener() {
        this.aiWorker.addEventListener('message', (e) => {
            const { type, move } = e.data;

            if (type === 'moveCalculated') {
                if (move) {
                    this.makeMove(move[0], move[1], this.currentPlayer);
                    this.switchPlayer();
                    this.render();
                    this.updateGameInfo();

                    const gameOver = this.checkGameOver();
                    if (gameOver) {
                        document.getElementById('gameStatus').textContent = gameOver;
                    } else {
                        // Check if new current player has valid moves
                        const validMoves = this.getAllValidMoves(this.currentPlayer);
                        if (validMoves.length === 0) {
                            document.getElementById('gameStatus').textContent = `${this.currentPlayer} has no valid moves. Passing turn.`;
                            setTimeout(() => {
                                this.switchPlayer();
                                this.render();
                                this.updateGameInfo();
                            }, 1500);
                        }
                    }
                }
            }
        });
    }

    requestAIMove() {
        // Convert Map to plain object for worker transfer
        const boardData = Object.fromEntries(this.board);

        // Send request to worker
        this.aiWorker.postMessage({
            type: 'calculateMove',
            boardData: boardData,
            color: this.currentPlayer
        });
    }

    render() {
        const boardElement = document.getElementById('board');
        boardElement.innerHTML = '';

        const bounds = this.getBoardBounds();
        const validMoves = this.getAllValidMoves(this.currentPlayer);

        // Create grid
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;

                const piece = this.getPiece(x, y);
                if (piece) {
                    const disc = document.createElement('div');
                    disc.className = `disc ${piece}`;
                    cell.appendChild(disc);
                }

                // Show valid moves
                const isValid = validMoves.some(([mx, my]) => mx === x && my === y);
                if (isValid) {
                    cell.classList.add('valid-move');
                }

                // Add coordinates display for debugging
                const coord = document.createElement('span');
                coord.className = 'coord';
                coord.textContent = `${x},${y}`;
                cell.appendChild(coord);

                cell.addEventListener('click', () => this.handleCellClick(x, y));
                boardElement.appendChild(cell);
            }
        }

        // Set grid dimensions
        const width = bounds.maxX - bounds.minX + 1;
        const height = bounds.maxY - bounds.minY + 1;
        boardElement.style.gridTemplateColumns = `repeat(${width}, 60px)`;
        boardElement.style.gridTemplateRows = `repeat(${height}, 60px)`;
    }

    handleCellClick(x, y) {
        const gameOver = this.checkGameOver();
        if (gameOver) {
            return;
        }

        if (this.makeMove(x, y, this.currentPlayer)) {
            this.switchPlayer();
            this.render();
            this.updateGameInfo();

            const gameOver = this.checkGameOver();
            if (gameOver) {
                document.getElementById('gameStatus').textContent = gameOver;
                return;
            }

            // Check if current player has valid moves
            const validMoves = this.getAllValidMoves(this.currentPlayer);
            if (validMoves.length === 0) {
                document.getElementById('gameStatus').textContent = `${this.currentPlayer} has no valid moves. Passing turn.`;
                setTimeout(() => {
                    this.switchPlayer();
                    this.render();
                    this.updateGameInfo();
                }, 1500);
                return;
            }

            // AI move if in AI mode and it's white's turn
            if (this.gameMode === 'ai' && this.currentPlayer === 'white') {
                setTimeout(() => {
                    this.requestAIMove();
                }, 500);
            }
        }
    }

    updateGameInfo() {
        const score = this.getScore();
        document.getElementById('blackScore').textContent = score.black;
        document.getElementById('whiteScore').textContent = score.white;
        document.getElementById('currentPlayer').textContent =
            `Current Player: ${this.currentPlayer.charAt(0).toUpperCase() + this.currentPlayer.slice(1)}`;
        document.getElementById('gameStatus').textContent = '';
    }

    setupEventListeners() {
        document.getElementById('newGame').addEventListener('click', () => {
            this.initGame();
        });

        document.getElementById('undo').addEventListener('click', () => {
            this.undo();
        });

        document.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.gameMode = e.target.value;
                this.initGame();
            });
        });

        // Cleanup worker on page unload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    cleanup() {
        if (this.aiWorker) {
            this.aiWorker.terminate();
        }
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new InfiniteReversi();
});
