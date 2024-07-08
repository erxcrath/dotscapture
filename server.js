const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const games = {};

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('joinGame', (gameId) => {
    if (!games[gameId]) {
      games[gameId] = {
        players: [],
        gameState: {
          dots: [],
          scoreRed: 0,
          scoreBlue: 0,
          currentTurn: 'player1'
        }
      };
    }

    if (games[gameId].players.length < 2) {
      const playerType = games[gameId].players.length === 0 ? 'player1' : 'player2';
      games[gameId].players.push({ id: socket.id, type: playerType });
      socket.join(gameId);
      socket.emit('gameJoined', { playerType, gameState: games[gameId].gameState });

      if (games[gameId].players.length === 2) {
        io.to(gameId).emit('gameStart', games[gameId].gameState);
      }
    } else {
      socket.emit('gameFull');
    }
  });

  socket.on('placeDot', ({ gameId, x, y, type }) => {
    if (games[gameId] && games[gameId].gameState.currentTurn === type) {
      const newDot = { x, y, type };
      games[gameId].gameState.dots.push(newDot);
      games[gameId].gameState.currentTurn = type === 'player1' ? 'player2' : 'player1';
      io.to(gameId).emit('dotPlaced', newDot);
      io.to(gameId).emit('turnChange', games[gameId].gameState.currentTurn);
    }
  });

  socket.on('updateScore', ({ gameId, scoreRed, scoreBlue }) => {
    if (games[gameId]) {
      games[gameId].gameState.scoreRed = scoreRed;
      games[gameId].gameState.scoreBlue = scoreBlue;
      io.to(gameId).emit('scoreUpdated', { scoreRed, scoreBlue });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    // Gérer la déconnexion et nettoyer les jeux si nécessaire
  });
});

http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});