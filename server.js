const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mysql = require('mysql');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');

// Configuration du port
const PORT = process.env.PORT || 3000;

// Configurer la session Express
const sessionMiddleware = session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true
});

// Garder une trace des joueurs en ligne
const onlinePlayers = new Map();
const games = {};

// Ajouter ces variables au début du fichier, après la déclaration des autres variables
const matchRequests = new Map(); // Pour stocker les demandes de match en cours

// Utiliser la session dans Express
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware d'authentification
function requireLogin(req, res, next) {
    if (req.session.loggedin) {
        return next();
    }
    res.redirect('/login');
}

app.use((req, res, next) => {
    if (req.path !== '/login' && req.path !== '/register') {
        requireLogin(req, res, next);
    } else {
        next();
    }
});

// Configuration de MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'circle_game'
});

db.connect((err) => {
    if (err) throw err;
    console.log('MySQL Connected...');

    // Créer la table users si elle n'existe pas
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            score INT DEFAULT 0,
            games_played INT DEFAULT 0
        )
    `;
    
    db.query(createTableQuery, (err) => {
        if (err) throw err;
        console.log('Users table checked/created');
    });
});

// Routes
app.get('/', (req, res) => {
    if (req.session.loggedin) {
        res.redirect('/accueil');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

app.get('/register', (req, res) => {
    res.sendFile(__dirname + '/public/register.html');
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (username && password) {
        bcrypt.hash(password, 8, (err, hash) => {
            if (err) throw err;
            db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash], (err) => {
                if (err) {
                    return res.status(500).send('Error registering user');
                }
                res.redirect('/login');
            });
        });
    } else {
        res.status(400).send('Please enter username and password');
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username && password) {
        db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
            if (err) throw err;
            if (results.length > 0) {
                bcrypt.compare(password, results[0].password, (err, match) => {
                    if (match) {
                        req.session.loggedin = true;
                        req.session.username = username;
                        res.redirect('/accueil');
                    } else {
                        res.status(401).send('Incorrect password!');
                    }
                });
            } else {
                res.status(404).send('User not found');
            }
        });
    } else {
        res.status(400).send('Please enter username and password');
    }
});

app.get('/accueil', (req, res) => {
    res.sendFile(__dirname + '/public/accueil.html');
});

app.get('/game', (req, res) => {
    res.sendFile(__dirname + '/public/game.html');
});

app.get('/logout', (req, res) => {
    if (req.session.username) {
        // Trouver et supprimer le joueur de la liste des joueurs en ligne
        for (const [socketId, player] of onlinePlayers.entries()) {
            if (player.username === req.session.username) {
                onlinePlayers.delete(socketId);
                io.emit('updateOnlinePlayers', Array.from(onlinePlayers.values()));
                break;
            }
        }
    }
    
    req.session.destroy((err) => {
        if(err) {
            console.log(err);
        }
        res.redirect('/login');
    });
});

// Servir les fichiers statiques
app.use(express.static('public'));

// Attacher la session à Socket.IO
io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Gestion des connexions Socket.IO
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Ajouter le joueur connecté à la liste des joueurs en ligne
    if (socket.request.session?.username) {
        onlinePlayers.set(socket.id, {
            username: socket.request.session.username,
            inGame: false
        });
        io.emit('updateOnlinePlayers', Array.from(onlinePlayers.values()));
    }

    // Gestion des joueurs en ligne
    socket.on('requestOnlinePlayers', () => {
        socket.emit('updateOnlinePlayers', Array.from(onlinePlayers.values()));
    });

    // Gestion du classement
    socket.on('requestLeaderboard', () => {
        db.query('SELECT username, score, games_played FROM users ORDER BY score DESC LIMIT 10', (err, results) => {
            if (err) throw err;
            socket.emit('updateLeaderboard', results);
        });
    });

    // Ajoutez dans la section socket.io de server.js
socket.on('miseATerre', ({ gameId }) => {
  if (games[gameId]) {
      const game = games[gameId];
      const currentPlayer = game.players.find(p => p.id === socket.id);
      
      if (currentPlayer && currentPlayer.type === game.gameState.currentTurn) {
          const playerDots = game.gameState.dots.filter(dot => dot.type === currentPlayer.type);
          const opponentType = currentPlayer.type === 'player1' ? 'player2' : 'player1';
          
          // Pour chaque point du joueur, vérifier les cases adjacentes vides
          const newDots = [];
          const existingPositions = new Set(game.gameState.dots.map(dot => `${dot.x},${dot.y}`));
          
          playerDots.forEach(dot => {
              // Vérifier les 8 positions adjacentes
              [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]].forEach(([dx, dy]) => {
                  const newX = dot.x + dx;
                  const newY = dot.y + dy;
                  
                  // Vérifier si la position est valide et vide
                  if (newX >= 0 && newX < 39 && newY >= 0 && newY < 32 &&
                      !existingPositions.has(`${newX},${newY}`)) {
                      // Ajouter le nouveau point et mettre à jour les positions existantes
                      newDots.push({ x: newX, y: newY, type: opponentType });
                      existingPositions.add(`${newX},${newY}`);
                  }
              });
          });
          
          // Ajouter les nouveaux points au jeu
          newDots.forEach(newDot => {
              game.gameState.dots.push(newDot);
              io.to(gameId).emit('dotPlaced', newDot);
          });
          
           // Signal pour déclencher la vérification finale des captures
           io.to(gameId).emit('checkCapturesAndEndGame');
      }
  }
});
    socket.on('requestMatch', (data) => {
        const fromPlayer = socket.request.session.username;
        const toPlayer = data.toPlayer;

        // Trouver le socket ID du joueur ciblé
        let toPlayerSocketId = null;
        for (const [socketId, player] of onlinePlayers.entries()) {
            if (player.username === toPlayer) {
                toPlayerSocketId = socketId;
                break;
            }
        }

        if (toPlayerSocketId) {
            // Sauvegarder la demande de match
            matchRequests.set(toPlayerSocketId, {
                from: fromPlayer,
                fromSocketId: socket.id
            });

            // Envoyer la demande au joueur ciblé
            io.to(toPlayerSocketId).emit('matchRequest', {
                fromPlayer: fromPlayer
            });
        }
    });

    socket.on('acceptMatch', () => {
        const request = matchRequests.get(socket.id);
        if (request) {
            // Créer une nouvelle partie
            const gameId = Math.random().toString(36).substring(2, 8);
            console.log(`Nouvelle partie créée: ${gameId}`);
            
            // Créer la partie dans games
            games[gameId] = {
                players: [],
                gameState: {
                    dots: [],
                    scoreRed: 0,
                    scoreBlue: 0,
                    currentTurn: 'player1'
                }
            };
            
            // Informer les deux joueurs
            io.to(request.fromSocketId).emit('matchAccepted', gameId);
            io.to(socket.id).emit('matchAccepted', gameId);
            
            // Nettoyer la demande
            matchRequests.delete(socket.id);
        }
    });
    
    socket.on('declineMatch', () => {
        const request = matchRequests.get(socket.id);
        if (request) {
            // Informer le joueur qui a fait la demande
            io.to(request.fromSocketId).emit('matchDeclined', socket.request.session.username);
            
            // Nettoyer la demande
            matchRequests.delete(socket.id);
        }
    });

    socket.on('joinGame', (gameId) => {
        console.log(`Tentative de rejoindre la partie ${gameId}`);
        const session = socket.request.session;
        if (session?.loggedin) {
            if (!games[gameId]) {
                games[gameId] = {
                    players: [],
                    gameState: {
                        dots: [],
                        scoreRed: 0,
                        scoreBlue: 0,
                        currentTurn: 'player1',
                        player1Name: null,
                        player2Name: null
                    }
                };
            }
    
            if (games[gameId].players.length < 2) {
                if (onlinePlayers.has(socket.id)) {
                    const player = onlinePlayers.get(socket.id);
                    player.inGame = true;
                    onlinePlayers.set(socket.id, player);
                    io.emit('updateOnlinePlayers', Array.from(onlinePlayers.values()));
                }
    
                const playerType = games[gameId].players.length === 0 ? 'player1' : 'player2';
                
                // Stocker le nom du joueur
                if (playerType === 'player1') {
                    games[gameId].gameState.player1Name = session.username;
                } else {
                    games[gameId].gameState.player2Name = session.username;
                }
    
                games[gameId].players.push({ 
                    id: socket.id, 
                    type: playerType, 
                    username: session.username 
                });
                
                socket.join(gameId);
                socket.emit('gameJoined', { 
                    playerType, 
                    gameState: games[gameId].gameState,
                    gameId: gameId
                });
    
                if (games[gameId].players.length === 2) {
                    io.to(gameId).emit('gameStart', games[gameId].gameState);
                }
                
                console.log(`Joueur ${session.username} a rejoint la partie ${gameId} comme ${playerType}`);
            } else {
                socket.emit('gameFull');
            }
        } else {
            socket.emit('notAuthenticated');
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
            
            // Mise à jour des scores dans la base de données
            const game = games[gameId];
            if (game.players.length === 2) {
                const winner = scoreRed > scoreBlue ? game.players[0] : game.players[1];
                const updateQuery = `
                    UPDATE users 
                    SET score = score + ?, games_played = games_played + 1 
                    WHERE username = ?
                `;
                
                if (winner) {
                    const playerSocket = io.sockets.sockets.get(winner.id);
                    if (playerSocket?.request?.session?.username) {
                        db.query(updateQuery, [1, playerSocket.request.session.username], (err) => {
                            if (err) console.error('Error updating winner score:', err);
                        });
                    }
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Retirer le joueur de la liste des joueurs en ligne
        if (onlinePlayers.has(socket.id)) {
            onlinePlayers.delete(socket.id);
            io.emit('updateOnlinePlayers', Array.from(onlinePlayers.values()));
        }

        // Gérer la déconnexion pour les parties en cours
        for (const gameId in games) {
            const game = games[gameId];
            const playerIndex = game.players.findIndex(player => player.id === socket.id);

            if (playerIndex !== -1) {
                game.players.splice(playerIndex, 1);

                if (game.players.length === 1) {
                    io.to(gameId).emit('playerDisconnected');
                } else if (game.players.length === 0) {
                    delete games[gameId];
                }
                break;
            }
        }
    });
});

// Lancer le serveur
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});