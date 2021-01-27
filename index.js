import WebSocket from 'ws';

import * as Chess from './chess.js';

const port = parseInt(process.env.PORT || '3000');

const ws = new WebSocket.Server({port});

const games = new Map();

function playerLost(game, player) {
    console.log(`Player ${player} lost game ${game}`);

    game.players.forEach(p => {
        p.send(JSON.stringify({
            command: 'lost',
            isPlayer: p === player,
            isHost: game.host === player,
        }));
    });
}

function playerWon(game, player) {
    console.log(`Player ${player} won game ${game}`);

    game.players.forEach(p => {
        p.send(JSON.stringify({
            command: 'won',
            isPlayer: p === player,
            isHost: game.host === player,
        }));
    });
}

function gameDraw(game) {
    console.log(`Game ${game} ended in a Draw`);

    game.players.forEach(p => {
        p.send(JSON.stringify({
            command: 'draw',
        }));
    });
}

const commands = {
    createGame: async (socket) => {
        let gameid;
        while (games.has(gameid = Math.random().toString().replace('.', '')));

        const game = {
            won: null,
            lost: null,
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
        };

        console.log(`New Game: ${gameid}`);
        games.set(gameid, game);

        socket.send(JSON.stringify({
            command: 'createGame',
            gameid,
            game,
        }));

        socket.gameid = gameid;
    },

    joinGame: async (socket, {gameid}) => {
        if (!games.has(gameid)) {
            socket.send(JSON.stringify({
                command: 'gameNotFound',
                gameid: gameid,
            }));
        } else if (games.get(gameid).player2) {
            socket.send(JSON.stringify({
                command: 'gameFull',
                gameid: gameid,
            }));
        }

        const game = games.get(gameid);

        game.player2 = socket;

        socket.send(JSON.stringify({
            command: 'joinGame',
            gameid: gameid,
            game: {
                player2Color: game.player2Color,
                currPlayer: game.currPlayer,
            },
        }));

        socket.gameid = gameid;

        game.player1.send(JSON.stringify({
            command: 'start',
        }));

        game.player2.send(JSON.stringify({
            command: 'start',
        }));
    },

    commitMovement: async (socket, {i, j, newI, newJ}) => {
        if (socket.won || socket.lost) {
            return;
        }

        const game = games.get(socket.gameid);
        if (!game) {
            return;
        }

        if (game.player1 !== socket && game.player2 !== socket) {
            return;
        }

        if (game.player1 === socket && game.player1Color !== game.currPlayer) {
            return;
        } else if (game.player2 === socket && game.player2Color !== game.currPlayer) {
            return;
        }

        const piece = game.board[i][j];

        if (newI === i && newJ === j) {
            return;
        }

        if (!Chess.isValidMove(piece, i, j, newI, newJ, game.board, game.lastMoved)) {
            return;
        }

        let capture = false;
        let enPassant = false;
        let promotion = false;
        let castling = 0;
        let check = false;
        let checkMate = false;

        let takenPiece = game.board[newI][newJ];
        if (piece.char === 'P' && !takenPiece && newJ !== j && ((piece.color === 'white' && i === 3) || (piece.color === 'black' && i === 4))) {
            enPassant = true;
            takenPiece = game.board[i][newJ];
            game.board[i][newJ] = null;
        }

        capture = !!takenPiece;

        const boardCopy = [...game.board.map(r => [...r])];

        game.board[i][j] = null;
        game.board[newI][newJ] = piece;

        if (piece.char === 'K' && Math.abs(newJ - j) === 2) {
            if (newJ > j) {
                const rook = game.board[i][7];
                game.board[i][j + 1] = rook;
                game.board[i][7] = null;
                castling = 1;
            } else {
                const rook = game.board[i][0];
                game.board[i][j - 1] = rook;
                game.board[i][0] = null;
                castling = 2;
            }
        }

        const KingW_i = game.board.findIndex(row => row.find(p => p?.char === 'K' && p?.color === 'white'));
        const KingW_j = game.board[KingW_i].findIndex(p => p?.char === 'K' && p?.color === 'white');

        const KingB_i = game.board.findIndex(row => row.find(p => p?.char === 'K' && p?.color === 'black'));
        const KingB_j = game.board[KingB_i].findIndex(p => p?.char === 'K' && p?.color === 'black');

        if (Chess.isChecked('white', KingW_i, KingW_j, game.board)) {
            if (game.color === 'white') {
                game.board = boardCopy;
                return;
            } else {
                check = true;
            }
        }

        if (Chess.isChecked('black', KingB_i, KingB_j, game.board)) {
            if (game.color === 'black') {
                game.board = boardCopy;
                return;
            } else {
                check = true;
            }
        }

        if (piece.char === 'P' && Math.abs(newI - i) === 2) {
            piece.longMove = true;
        }

        piece.neverMoved = false;
        takenPiece && game.takenPieces.push(takenPiece);

        if (piece.char === 'P' && [0, 7].includes(newI)) {
            Chess.promove(piece, newI, newJ, game.promoteTo, game.board);
            promotion = true;
        }

        if (Chess.isCheckMate('white', KingW_i, KingW_j, game.board)) {
            game.won = (game.color === 'black');
            game.lose = (game.color === 'white');
            game.draw = false;

            if (game.won) {
                game.result = '0-1';
            } else {
                game.result = '1-0';
            }

            checkMate = true;
        } else if (Chess.isCheckMate('black', KingB_i, KingB_j, game.board)) {
            game.won = (game.color === 'white');
            game.lose = (game.color === 'black');
            game.draw = false;

            if (game.won) {
                game.result = '1-0';
            } else {
                game.result = '0-1';
            }

            checkMate = true;
        } else if (Chess.isStaleMate('black', KingB_i, KingB_j, game.board) || Chess.isStaleMate('white', KingW_i, KingW_j, game.board)) {
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

        const duplicate = Chess.findDuplicateMovement(piece, newI, newJ, game.board, game.lastMoved);
        let mov = `${piece.char !== 'P' ? piece.char : ''}`;
        if (duplicate?.x === i) {
            mov += ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'][j];
        }

        if (duplicate?.y === j) {
            mov += 1 + i;
        }

        if (capture) {
            if (piece.char === 'P') {
                mov += ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'][j];
            }

            mov += 'x';
        }

        mov += `${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'][newJ]}${1 + newI}`;

        if (enPassant) {
            mov += 'e.p';
        }

        if (checkMate) {
            game.movements.push(mov + '#');
        } else if (check) {
            game.movements.push(mov + '+');
        } else if (castling) {
            game.movements.push(['0-0', '0-0-0'][castling - 1]);
        } else if (promotion) {
            game.movements.push(`${['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'][newJ]}${1 + newI}${piece.char}`);
        } else {
            game.movements.push(mov);
        }

        if (!capture || piece.char !== 'P') {
            game.noCaptureOrPawnsQ++;
        } else {
            game.noCaptureOrPawnsQ = 0;
        }

        game.currPlayer = (game.currPlayer === 'white' ? 'black' : 'white');

        game.lastMoved = piece;

        game.player1.send(JSON.stringify({
            command: 'commitMovement',
            i,
            j,
            newI,
            newJ,
            game: {
                currPlayer: game.currPlayer
            },
        }));

        game.player2.send(JSON.stringify({
            command: 'commitMovement',
            i,
            j,
            newI,
            newJ,
            game: {
                currPlayer: game.currPlayer
            },
        }));
    },

    restart: async (socket, message) => {
        const game = games.get(socket.gameid);

        if (!game) {
            return;
        }

        if (game.host === socket) {
            game.players.forEach(socket => {
                socket.send(JSON.stringify({
                    command: 'seed',
                    seed: game.seed,
                }));
            });
        }
    },
};

ws.on('connection', async socket => {


    socket.on('message', async message => {
        message = JSON.parse(message);

        if (!(message.command in commands)) {
            return;
        }

        await commands[message.command](socket, message);
    });
});
