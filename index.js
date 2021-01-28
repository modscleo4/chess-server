import WebSocket from 'ws';

import * as Chess from './chess.js';

const port = parseInt(process.env.PORT || '3000');

const ws = new WebSocket.Server({port});

/**
 * @typedef {Object} Game
 * @property {boolean | null} won
 * @property {boolean | null} lose
 * @property {boolean} draw
 *
 * @property {(Chess.Piece | null)[][]} board
 *
 * @property {WebSocket | null} player1
 * @property {string} player1Color
 *
 * @property {WebSocket | null} player2
 * @property {string} player2Color
 *
 * @property {string} currPlayer
 * @property {Chess.Piece | null} lastMoved
 *
 * @property {{i: number, j: number, newI: number, newJ: number, str: string}[]} movements
 * @property {Chess.Piece[]} takenPieces
 * @property {*[]} currentMove
 *
 * @property {string | null} result
 * @property {number} noCaptureOrPawnsQ
 */

/**
 * @type {Map<string, Game>}
 */
const games = new Map();

const commands = {
    /**
     *
     * @param {WebSocket} socket
     */
    createGame: async (socket) => {
        let gameid;
        while (games.has(gameid = Math.random().toString().replace('.', '')));

        /**
         * @type {Game}
         */
        const game = {
            won: null,
            lose: null,
            draw: false,

            board: Chess.generateArray(),

            player1: socket,
            player1Color: 'white',

            player2: null,
            player2Color: 'black',

            currPlayer: 'white',
            lastMoved: null,

            movements: [],
            takenPieces: [],
            currentMove: [],

            result: null,
            noCaptureOrPawnsQ: 0,
        };

        console.log(`New Game: ${gameid}`);
        games.set(gameid, game);

        socket.send(JSON.stringify({
            command: 'createGame',
            gameid,
            game: {
                playerColor: game.player1 === socket ? game.player1Color : game.player2Color,
                currPlayer: game.currPlayer,
            }
        }));

        socket.gameid = gameid;
    },

    /**
     *
     * @param {WebSocket} socket
     * @param {Object} data
     * @param {string} data.gameid
     */
    joinGame: async (socket, {gameid}) => {
        const game = games.get(gameid);

        if (!game) {
            socket.send(JSON.stringify({
                command: 'gameNotFound',
                gameid: gameid,
            }));

            return;
        } else if (game.player1 && game.player2) {
            socket.send(JSON.stringify({
                command: 'gameFull',
                gameid: gameid,
            }));

            return;
        }

        if (!game.player1) {
            game.player1 = socket;
        } else {
            game.player2 = socket;
        }

        socket.send(JSON.stringify({
            command: 'joinGame',
            gameid: gameid,
            game: {
                movements: game.movements,
                playerColor: game.player1 === socket ? game.player1Color : game.player2Color,
                currPlayer: game.currPlayer,
            },
        }));

        socket.gameid = gameid;

        game.player1?.send(JSON.stringify({
            command: 'start',
        }));

        game.player2?.send(JSON.stringify({
            command: 'start',
        }));
    },

    /**
     *
     * @param {WebSocket} socket
     * @param {Object} data
     * @param {number} data.i
     * @param {number} data.j
     * @param {number} data.newI
     * @param {number} data.newJ
     * @param {string} data.promoteTo
     */
    commitMovement: async (socket, {i, j, newI, newJ, promoteTo}) => {
        const game = games.get(socket.gameid);
        if (!game) {
            return;
        }

        if (game.won || game.lose) {
            return;
        }

        if (game.player1 === socket && game.player1Color !== game.currPlayer) {
            return;
        } else if (game.player2 === socket && game.player2Color !== game.currPlayer) {
            return;
        }

        const piece = game.board[i][j];

        if (!piece) {
            return;
        }

        if (newI === i && newJ === j) {
            return;
        }

        if (!Chess.isValidMove(piece, i, j, newI, newJ, game.board, game.lastMoved)) {
            return;
        }

        let capture = false;

        let takenPiece = game.board[newI][newJ];
        if (piece.char === 'P' && !takenPiece && newJ !== j && ((piece.color === 'white' && i === 3) || (piece.color === 'black' && i === 4))) {
            takenPiece = game.board[i][newJ];
            game.board[i][newJ] = null;
        }

        capture = !!takenPiece;

        const boardCopy = game.board.map(r => [...r]);

        game.board[i][j] = null;
        game.board[newI][newJ] = piece;

        if (piece.char === 'P' && [0, 7].includes(newI)) {
            Chess.promove(piece, newI, newJ, promoteTo, game.board);
        }

        if (piece.char === 'K' && Math.abs(newJ - j) === 2) {
            if (newJ > j) {
                const rook = game.board[i][7];
                game.board[i][j + 1] = rook;
                game.board[i][7] = null;
            } else {
                const rook = game.board[i][0];
                game.board[i][j - 1] = rook;
                game.board[i][0] = null;
            }
        }

        const KingW_i = game.board.findIndex(row => row.find(p => p?.char === 'K' && p?.color === 'white'));
        const KingW_j = game.board[KingW_i].findIndex(p => p?.char === 'K' && p?.color === 'white');

        const KingB_i = game.board.findIndex(row => row.find(p => p?.char === 'K' && p?.color === 'black'));
        const KingB_j = game.board[KingB_i].findIndex(p => p?.char === 'K' && p?.color === 'black');

        if (Chess.isChecked('white', KingW_i, KingW_j, game.board)) {
            if (game.currPlayer === 'white') {
                game.board = boardCopy;
                return;
            }
        }

        if (Chess.isChecked('black', KingB_i, KingB_j, game.board)) {
            if (game.currPlayer === 'black') {
                game.board = boardCopy;
                return;
            }
        }

        if (piece.char === 'P' && Math.abs(newI - i) === 2) {
            piece.longMove = true;
        }

        piece.neverMoved = false;
        takenPiece && game.takenPieces.push(takenPiece);

        if (Chess.isCheckMate('white', KingW_i, KingW_j, game.board, game.lastMoved)) {
            game.won = (game.currPlayer === 'black');
            game.lose = (game.currPlayer === 'white');
            game.draw = false;

            if (game.won) {
                game.result = '0-1';
            } else {
                game.result = '1-0';
            }
        } else if (Chess.isCheckMate('black', KingB_i, KingB_j, game.board, game.lastMoved)) {
            game.won = (game.currPlayer === 'white');
            game.lose = (game.currPlayer === 'black');
            game.draw = false;

            if (game.won) {
                game.result = '1-0';
            } else {
                game.result = '0-1';
            }
        } else if (Chess.isStaleMate('black', KingB_i, KingB_j, game.board, game.lastMoved) || Chess.isStaleMate('white', KingW_i, KingW_j, game.board, game.lastMoved)) {
            game.won = false;
            game.lose = false;
            game.draw = true;

            game.result = '½–½';
        } else if (Chess.insufficientMaterial(game.board)) {
            game.won = false;
            game.lose = false;
            game.draw = true;

            game.result = '½–½';
        } else if (game.noCaptureOrPawnsQ === 100) {
            game.won = false;
            game.lose = false;
            game.draw = true;

            game.result = '½–½';
        } else if (Chess.threefoldRepetition(game.movements)) {
            game.won = false;
            game.lose = false;
            game.draw = true;

            game.result = '½–½';
        }

        game.movements.push({i, j, newI, newJ, get str() {return `${this.i}${this.j} ${this.newI}${this.newJ}`;} });

        if (!capture || piece.char !== 'P') {
            game.noCaptureOrPawnsQ++;
        } else {
            game.noCaptureOrPawnsQ = 0;
        }

        game.currPlayer = (game.currPlayer === 'white' ? 'black' : 'white');

        game.lastMoved = piece;

        game.player1?.send(JSON.stringify({
            command: 'commitMovement',
            i,
            j,
            newI,
            newJ,
            game: {
                currPlayer: game.currPlayer,
                promoteTo,
            },
        }));

        game.player2?.send(JSON.stringify({
            command: 'commitMovement',
            i,
            j,
            newI,
            newJ,
            game: {
                currPlayer: game.currPlayer,
                promoteTo,
            },
        }));
    },
};

ws.on('connection', async socket => {
    socket.on('close', () => {
        const game = games.get(socket.gameid);

        if (!game) {
            return;
        }

        if (game.player1 === socket) {
            game.player1 = null;
            game.player2?.send(JSON.stringify({
                command: 'playerDisconnected',
            }));
        } else {
            game.player2 = null;
            game.player1?.send(JSON.stringify({
                command: 'playerDisconnected',
            }));
        }

        if (!game.player1 && !game.player2) {
            games.delete(socket.gameid);
        }
    });

    socket.on('message', async message => {
        message = JSON.parse(message);

        if (!(message.command in commands)) {
            return;
        }

        await commands[message.command](socket, message);
    });
});
