import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ========== GAME STATE ==========
class GameState {
    constructor() {
        this.board = this.createEmptyBoard();
        this.currentPlayer = 1; // 1 = Black, 2 = White
        this.moveHistory = [];
    }

    createEmptyBoard() {
        return Array(8).fill(null).map(() =>
            Array(8).fill(null).map(() =>
                Array(8).fill(0)
            )
        );
    }

    reset() {
        this.board = this.createEmptyBoard();
        this.currentPlayer = 1;
        this.moveHistory = [];

        // 3D Starting position - 8 pieces in center 2x2x2 cube
        // Black pieces (player 1) - diagonal pattern
        this.setCell(3, 3, 3, 1);
        this.setCell(4, 4, 3, 1);
        this.setCell(3, 4, 4, 1);
        this.setCell(4, 3, 4, 1);

        // White pieces (player 2) - opposite diagonal pattern
        this.setCell(3, 4, 3, 2);
        this.setCell(4, 3, 3, 2);
        this.setCell(3, 3, 4, 2);
        this.setCell(4, 4, 4, 2);
    }

    getCell(x, y, z) {
        if (!this.isValidPosition(x, y, z)) return null;
        return this.board[x][y][z];
    }

    setCell(x, y, z, player) {
        if (!this.isValidPosition(x, y, z)) return false;
        this.board[x][y][z] = player;
        return true;
    }

    isValidPosition(x, y, z) {
        return x >= 0 && x < 8 && y >= 0 && y < 8 && z >= 0 && z < 8;
    }

    getPieceCount(player) {
        let count = 0;
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                for (let z = 0; z < 8; z++) {
                    if (this.board[x][y][z] === player) count++;
                }
            }
        }
        return count;
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    }

    clone() {
        const cloned = new GameState();
        cloned.board = this.board.map(plane => plane.map(row => row.slice()));
        cloned.currentPlayer = this.currentPlayer;
        cloned.moveHistory = [...this.moveHistory];
        return cloned;
    }
}

// ========== MOVE ==========
class Move {
    constructor(x, y, z, player, flippedPieces = []) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.player = player;
        this.flippedPieces = flippedPieces;
    }

    apply(gameState) {
        gameState.setCell(this.x, this.y, this.z, this.player);
        for (const pos of this.flippedPieces) {
            gameState.setCell(pos.x, pos.y, pos.z, this.player);
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

    static findFlippablePieces(gameState, x, y, z, player) {
        const opponent = player === 1 ? 2 : 1;
        let allFlippable = [];

        for (const [dx, dy, dz] of Rules.DIRECTIONS) {
            let flippableInDir = [];
            let nx = x + dx, ny = y + dy, nz = z + dz;

            while (gameState.isValidPosition(nx, ny, nz)) {
                const cell = gameState.getCell(nx, ny, nz);
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

    static getLegalMoves(gameState, player) {
        const legalMoves = [];
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                for (let z = 0; z < 8; z++) {
                    if (gameState.getCell(x, y, z) === 0) {
                        const flippable = Rules.findFlippablePieces(gameState, x, y, z, player);
                        if (flippable.length > 0) {
                            legalMoves.push(new Move(x, y, z, player, flippable));
                        }
                    }
                }
            }
        }
        return legalMoves;
    }

    static isGameOver(gameState) {
        return Rules.getLegalMoves(gameState, 1).length === 0 &&
               Rules.getLegalMoves(gameState, 2).length === 0;
    }

    static getWinner(gameState) {
        const blackCount = gameState.getPieceCount(1);
        const whiteCount = gameState.getPieceCount(2);
        if (blackCount > whiteCount) return 1;
        if (whiteCount > blackCount) return 2;
        return 0;
    }
}

// ========== AI WORKER WRAPPER ==========
class AIWorker {
    constructor(player, difficulty = 2) {
        this.player = player;
        this.difficulty = difficulty;
        this.worker = new Worker('ai-worker.js');
    }

    async selectMove(gameState) {
        return new Promise((resolve) => {
            // Set up one-time message listener
            const handleMessage = (e) => {
                const { move } = e.data;
                this.worker.removeEventListener('message', handleMessage);

                // Convert plain object back to Move instance if move exists
                if (move) {
                    resolve(new Move(move.x, move.y, move.z, move.player, move.flippedPieces));
                } else {
                    resolve(null);
                }
            };

            this.worker.addEventListener('message', handleMessage);

            // Send board state to worker
            this.worker.postMessage({
                board: gameState.board,
                player: this.player,
                difficulty: this.difficulty
            });
        });
    }

    terminate() {
        this.worker.terminate();
    }
}

// ========== GAME CLASS ==========
class Game {
    constructor() {
        this.gameState = new GameState();
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.boardGroup = new THREE.Group();
        this.highlightGroup = new THREE.Group();
        this.piecesGroup = new THREE.Group();
        this.pieces = new Map();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.aiPlayer = null;
        this.aiPlayer2 = null; // Second AI for AI vs AI mode
        this.mode = null;
        this.isProcessing = false;
        this.currentLegalMoves = [];
        this.pieceGeometry = new THREE.SphereGeometry(0.4, 32, 32);
        this.blackMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.3, roughness: 0.4 });
        this.whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, metalness: 0.3, roughness: 0.4 });
        this.aiSpeed = 500; // AI thinking delay in ms
    }

    initialize() {
        const canvas = document.getElementById('game-canvas');
        this.container = document.getElementById('game-container');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf4f6f9);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.camera.position.set(12, 12, 12);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Lighting
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const light1 = new THREE.DirectionalLight(0xffffff, 0.8);
        light1.position.set(10, 15, 10);
        this.scene.add(light1);
        const light2 = new THREE.DirectionalLight(0xffffff, 0.4);
        light2.position.set(-10, 10, -10);
        this.scene.add(light2);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 8;
        this.controls.maxDistance = 30;
        this.controls.target.set(0, 0, 0);

        // Groups
        this.scene.add(this.boardGroup);
        this.scene.add(this.highlightGroup);
        this.scene.add(this.piecesGroup);

        // Create board
        this.createBoard();

        // Event listeners
        canvas.addEventListener('click', (e) => this.onClick(e));
        window.addEventListener('resize', () => this.onResize());

        // UI
        document.getElementById('reset-btn').addEventListener('click', () => this.resetGame());
        document.getElementById('new-game-btn').addEventListener('click', () => this.showMenu());
        document.getElementById('pvp-btn').addEventListener('click', () => this.startGame('pvp'));
        document.getElementById('pve-btn').addEventListener('click', () => this.startGame('pve'));
        document.getElementById('aivai-btn').addEventListener('click', () => this.startGame('aivai'));

        // Speed control
        const speedSlider = document.getElementById('speed-slider');
        const speedValue = document.getElementById('speed-value');
        speedSlider.addEventListener('input', (e) => {
            const speeds = ['Fast', 'Normal', 'Slow'];
            const delays = [200, 500, 1000];
            const index = parseInt(e.target.value);
            this.aiSpeed = delays[index];
            speedValue.textContent = speeds[index];
        });

        // Start
        this.animate();
        this.showMenu();
    }

    createBoard() {
        const gridMaterial = new THREE.LineBasicMaterial({ color: 0x4b6584, opacity: 0.35, transparent: true });

        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                this.createLine([-3.5, i-3.5, j-3.5], [4.5, i-3.5, j-3.5], gridMaterial);
                this.createLine([i-3.5, -3.5, j-3.5], [i-3.5, 4.5, j-3.5], gridMaterial);
                this.createLine([i-3.5, j-3.5, -3.5], [i-3.5, j-3.5, 4.5], gridMaterial);
            }
        }
    }

    createLine(start, end, material) {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...start),
            new THREE.Vector3(...end)
        ]);
        this.boardGroup.add(new THREE.Line(geometry, material));
    }

    gridToWorld(x, y, z) {
        return { x: x - 3.5, y: y - 3.5, z: z - 3.5 };
    }

    addPiece(x, y, z, player, animate = false) {
        const key = `${x},${y},${z}`;
        if (this.pieces.has(key)) this.removePiece(x, y, z);

        const material = player === 1 ? this.blackMaterial : this.whiteMaterial;
        const piece = new THREE.Mesh(this.pieceGeometry, material);
        const worldPos = this.gridToWorld(x, y, z);
        piece.position.set(worldPos.x, worldPos.y, worldPos.z);
        piece.userData = { gridX: x, gridY: y, gridZ: z, player };

        if (animate) {
            piece.scale.set(0.1, 0.1, 0.1);
            this.animateScale(piece, 0.1, 1.0, 200);
        }

        this.piecesGroup.add(piece);
        this.pieces.set(key, piece);
    }

    removePiece(x, y, z) {
        const key = `${x},${y},${z}`;
        const piece = this.pieces.get(key);
        if (piece) {
            this.piecesGroup.remove(piece);
            this.pieces.delete(key);
        }
    }

    flipPiece(x, y, z, toPlayer, animate = false) {
        const key = `${x},${y},${z}`;
        const piece = this.pieces.get(key);
        if (!piece) return;

        const newMaterial = toPlayer === 1 ? this.blackMaterial : this.whiteMaterial;
        piece.userData.player = toPlayer;

        if (animate) {
            this.animateFlip(piece, newMaterial);
        } else {
            piece.material = newMaterial;
        }
    }

    animateScale(piece, from, to, duration) {
        const startTime = Date.now();
        const animate = () => {
            const progress = Math.min((Date.now() - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const scale = from + (to - from) * eased;
            piece.scale.set(scale, scale, scale);
            if (progress < 1) requestAnimationFrame(animate);
        };
        animate();
    }

    animateFlip(piece, newMaterial) {
        const startTime = Date.now();
        const startRotation = piece.rotation.y;
        const animate = () => {
            const progress = Math.min((Date.now() - startTime) / 400, 1);
            const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            piece.rotation.y = startRotation + Math.PI * eased;
            if (progress >= 0.5 && piece.material !== newMaterial) {
                piece.material = newMaterial;
            }
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                piece.rotation.y = startRotation;
            }
        };
        animate();
    }

    updateHighlights() {
        while (this.highlightGroup.children.length > 0) {
            this.highlightGroup.remove(this.highlightGroup.children[0]);
        }

        const highlightGeometry = new THREE.SphereGeometry(0.3, 16, 16);
        const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0x27ae60, transparent: true, opacity: 0.5 });

        for (const move of this.currentLegalMoves) {
            const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
            const worldPos = this.gridToWorld(move.x, move.y, move.z);
            highlight.position.set(worldPos.x, worldPos.y, worldPos.z);
            highlight.userData = { gridX: move.x, gridY: move.y, gridZ: move.z };
            this.highlightGroup.add(highlight);
        }
    }

    onClick(event) {
        if (this.isProcessing) return;

        const rect = event.target.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.highlightGroup.children);

        if (intersects.length > 0) {
            const pos = intersects[0].object.userData;
            const move = this.currentLegalMoves.find(m => m.x === pos.gridX && m.y === pos.gridY && m.z === pos.gridZ);
            if (move) this.executeMove(move);
        }
    }

    executeMove(move) {
        this.isProcessing = true;

        this.addPiece(move.x, move.y, move.z, move.player, true);

        setTimeout(() => {
            for (const pos of move.flippedPieces) {
                this.flipPiece(pos.x, pos.y, pos.z, move.player, true);
            }
        }, 200);

        move.apply(this.gameState);

        setTimeout(() => {
            this.gameState.switchPlayer();

            if (Rules.isGameOver(this.gameState)) {
                this.endGame();
            } else {
                this.updateGameState();
                this.isProcessing = false;
            }
        }, 600);
    }

    updateGameState() {
        this.currentLegalMoves = Rules.getLegalMoves(this.gameState, this.gameState.currentPlayer);
        this.updateHighlights();
        this.updateUI();

        if (this.currentLegalMoves.length === 0) {
            this.handleNoLegalMoves();
        } else if (this.mode === 'pve' && this.gameState.currentPlayer === 2) {
            this.aiTurn();
        } else if (this.mode === 'aivai') {
            // In AI vs AI mode, trigger AI for current player
            this.aiTurn();
        }
    }

    handleNoLegalMoves() {
        const playerName = this.gameState.currentPlayer === 1 ? 'Black' : 'White';
        this.showMessage(`${playerName} has no legal moves. Switching turn...`, 2000);

        this.gameState.switchPlayer();

        setTimeout(() => {
            const otherPlayerMoves = Rules.getLegalMoves(this.gameState, this.gameState.currentPlayer);
            if (otherPlayerMoves.length === 0) {
                this.endGame();
            } else {
                this.updateGameState();
            }
        }, 2000);
    }

    async aiTurn() {
        this.isProcessing = true;

        // Select the appropriate AI worker
        const currentAI = this.gameState.currentPlayer === 1 ? this.aiPlayer :
                          (this.aiPlayer2 || this.aiPlayer);

        const playerName = this.gameState.currentPlayer === 1 ? 'Black AI' : 'White AI';
        if (this.mode === 'aivai') {
            this.showMessage(`${playerName} is thinking...`, 0);
        } else {
            this.showMessage('AI is thinking...', 0);
        }

        // Start the AI computation and add artificial delay in parallel
        const [move] = await Promise.all([
            currentAI.selectMove(this.gameState),
            new Promise(resolve => setTimeout(resolve, this.aiSpeed))
        ]);

        if (move) {
            this.hideMessage();
            this.executeMove(move);
        } else {
            this.isProcessing = false;
            this.handleNoLegalMoves();
        }
    }

    updateUI() {
        const blackCount = this.gameState.getPieceCount(1);
        const whiteCount = this.gameState.getPieceCount(2);
        const playerName = this.gameState.currentPlayer === 1 ? 'Black' : 'White';

        document.getElementById('score').textContent = `Black: ${blackCount} | White: ${whiteCount}`;
        document.getElementById('current-player-name').textContent = playerName;
        document.getElementById('legal-moves-count').textContent = `Legal moves: ${this.currentLegalMoves.length}`;
    }

    showMessage(text, duration = 3000) {
        const msg = document.getElementById('message-display');
        msg.textContent = text;
        msg.classList.add('show');
        if (duration > 0) {
            setTimeout(() => this.hideMessage(), duration);
        }
    }

    hideMessage() {
        document.getElementById('message-display').classList.remove('show');
    }

    endGame() {
        const winner = Rules.getWinner(this.gameState);
        const blackCount = this.gameState.getPieceCount(1);
        const whiteCount = this.gameState.getPieceCount(2);

        let message = winner === 0 ? `Game Over! It's a tie! (${blackCount} - ${whiteCount})` :
                      `Game Over! ${winner === 1 ? 'Black' : 'White'} wins! (${blackCount} - ${whiteCount})`;
        this.showMessage(message, 0);
    }

    showMenu() {
        document.getElementById('menu-screen').classList.remove('hidden');
        document.getElementById('speed-controls').classList.remove('show');
    }

    hideMenu() {
        document.getElementById('menu-screen').classList.add('hidden');
    }

    startGame(mode) {
        this.mode = mode;
        this.hideMenu();

        // Terminate existing workers if any
        if (this.aiPlayer) {
            this.aiPlayer.terminate();
            this.aiPlayer = null;
        }
        if (this.aiPlayer2) {
            this.aiPlayer2.terminate();
            this.aiPlayer2 = null;
        }

        // Set up AI workers based on mode
        if (mode === 'pve') {
            this.aiPlayer = new AIWorker(2, 2); // White AI
            document.getElementById('speed-controls').classList.remove('show');
        } else if (mode === 'aivai') {
            this.aiPlayer = new AIWorker(1, 2);  // Black AI
            this.aiPlayer2 = new AIWorker(2, 2); // White AI
            document.getElementById('speed-controls').classList.add('show');
        } else {
            document.getElementById('speed-controls').classList.remove('show');
        }

        this.resetGame();
    }

    resetGame() {
        this.gameState.reset();

        while (this.piecesGroup.children.length > 0) {
            this.piecesGroup.remove(this.piecesGroup.children[0]);
        }
        this.pieces.clear();

        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
                for (let z = 0; z < 8; z++) {
                    const player = this.gameState.getCell(x, y, z);
                    if (player !== 0) this.addPiece(x, y, z, player, false);
                }
            }
        }

        this.updateGameState();
        this.hideMessage();
    }

    onResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// Start game
document.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.initialize();

    // Clean up workers when page unloads
    window.addEventListener('beforeunload', () => {
        if (game.aiPlayer) game.aiPlayer.terminate();
        if (game.aiPlayer2) game.aiPlayer2.terminate();
    });
});
