const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const mysql = require("mysql");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const MySQLStore = require('express-mysql-session')(session);
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Map pour stocker les spectateurs
const spectators = new Map();

// Configuration MySQL
const dbConfig = {
  host: "nwhazdrp7hdpd4a4.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
  user: "q8r1hkm9a97oecvz",
  password: "gz2nl6w62xwddq0w",
  database: "qwkya7d3q2yxhzzu",
  port: 3306
};

// Initialisation de la connexion MySQL
let db;
if (process.env.JAWSDB_URL) {
    db = mysql.createConnection(process.env.JAWSDB_URL);
} else {
    db = mysql.createConnection(dbConfig);
}

// Fonction de gestion de la reconnexion
function handleDisconnect() {
    db = mysql.createConnection(process.env.JAWSDB_URL || dbConfig);
    
    db.connect(err => {
        if (err) {
            console.error('Erreur lors de la reconnexion:', err);
            setTimeout(handleDisconnect, 2000);
            return;
        }
        console.log('Reconnecté avec succès à MySQL');
    });

    db.on('error', err => {
        console.error('Erreur MySQL:', err);
        if (err.code === 'PROTOCOL_CONNECTION_LOST') {
            handleDisconnect();
        } else {
            throw err;
        }
    });
}

// Première connexion à la base de données
db.connect(err => {
    if (err) {
        console.error("Erreur de connexion à MySQL:", err);
        setTimeout(handleDisconnect, 2000);
        return;
    }
    console.log("Connecté à MySQL");

    // Création de la table users
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            score INT DEFAULT 0,
            games_played INT DEFAULT 0
        )
    `;

    db.query(createTableQuery, err => {
        if (err) {
            console.error("Erreur création table:", err);
            return;
        }
        console.log("Table users vérifiée/créée");
    });
});

// Configuration du store de session
const sessionStore = new MySQLStore(dbConfig);

// Configuration de la session
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || "your_secret_key",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
});

// Port du serveur
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Maps pour le jeu
const onlinePlayers = new Map();
const games = {};
const matchRequests = new Map();

// Middleware d'authentification
function requireLogin(req, res, next) {
    if (req.session && req.session.loggedin) {
        next();
    } else {
        req.session.returnTo = req.originalUrl;
        res.redirect("/login");
    }
}

// Routes principales
app.get('/', (req, res) => {
    if (req.session && req.session.loggedin) {
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

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (username && password) {
        bcrypt.hash(password, 8, (err, hash) => {
            if (err) {
                console.error("Erreur hash:", err);
                return res.status(500).send("Erreur d'enregistrement");
            }
            db.query(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                [username, hash],
                (err) => {
                    if (err) {
                        return res.status(500).send("Erreur d'enregistrement");
                    }
                    res.redirect("/login");
                }
            );
        });
    } else {
        res.status(400).send("Veuillez remplir tous les champs");
    }
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (username && password) {
        db.query(
            "SELECT * FROM users WHERE username = ?",
            [username],
            (err, results) => {
                if (err) {
                    console.error("Erreur SQL:", err);
                    return res.status(500).send("Erreur serveur");
                }
                if (results.length > 0) {
                    bcrypt.compare(password, results[0].password, (err, match) => {
                        if (err) {
                            console.error("Erreur bcrypt:", err);
                            return res.status(500).send("Erreur serveur");
                        }
                        if (match) {
                            req.session.loggedin = true;
                            req.session.username = username;
                            req.session.save(err => {
                                if (err) {
                                    console.error("Erreur session:", err);
                                    return res.status(500).send("Erreur session");
                                }
                                res.redirect("/accueil");
                            });
                        } else {
                            res.status(401).send("Mot de passe incorrect");
                        }
                    });
                } else {
                    res.status(404).send("Utilisateur non trouvé");
                }
            }
        );
    } else {
        res.status(400).send("Veuillez remplir tous les champs");
    }
});

app.get('/accueil', requireLogin, (req, res) => {
    res.sendFile(__dirname + '/public/accueil.html');
});

app.get('/game', requireLogin, (req, res) => {
    res.sendFile(__dirname + '/public/game.html');
});

app.get('/logout', (req, res) => {
    if (req.session.username) {
        // Suppression du joueur des joueurs en ligne
        for (const [socketId, player] of onlinePlayers.entries()) {
            if (player.username === req.session.username) {
                onlinePlayers.delete(socketId);
                io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
                break;
            }
        }
    }

    req.session.destroy(err => {
        if (err) {
            console.error("Erreur déconnexion:", err);
        }
        res.redirect("/login");
    });
});

// Socket.IO Middleware
io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Gestion des connexions Socket.IO
io.on("connection", (socket) => {
    console.log("Nouvelle connexion:", socket.id);

    const userDisconnectTimeouts = new Map();

    // Ajout du joueur connecté
    if (socket.request.session?.username) {
        const username = socket.request.session.username;

        if (userDisconnectTimeouts.has(username)) {
            clearTimeout(userDisconnectTimeouts.get(username));
            userDisconnectTimeouts.delete(username);
        }

        // Mise à jour des connexions existantes
        for (const [oldSocketId, player] of onlinePlayers.entries()) {
            if (player.username === username) {
                onlinePlayers.delete(oldSocketId);
                break;
            }
        }

        onlinePlayers.set(socket.id, {
            username: username,
            inGame: false,
            id: socket.id
        });
        
        io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    }

    // Gestion des événements socket
    socket.on("requestOnlinePlayers", () => {
        socket.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    });

    socket.on("requestLeaderboard", () => {
        db.query(
            "SELECT username, score, games_played FROM users ORDER BY score DESC LIMIT 10",
            (err, results) => {
                if (err) {
                    console.error("Erreur classement:", err);
                    return;
                }
                socket.emit("updateLeaderboard", results);
            }
        );
    });
// Gestion de la mise à terre
  socket.on("miseATerre", ({ gameId }) => {
    if (!games[gameId]) return;

    const game = games[gameId];
    const currentPlayer = game.players.find((p) => p.id === socket.id);

    if (!currentPlayer || currentPlayer.type !== game.gameState.currentTurn)
      return;

    const playerDots = game.gameState.dots.filter(
      (dot) => dot.type === currentPlayer.type
    );
    const opponentType =
      currentPlayer.type === "player1" ? "player2" : "player1";

    // Pour chaque point du joueur, vérifier les cases adjacentes vides
    const newDots = [];
    const existingPositions = new Set(
      game.gameState.dots.map((dot) => `${dot.x},${dot.y}`)
    );

    playerDots.forEach((dot) => {
      // Vérifier les 8 positions adjacentes
      [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ].forEach(([dx, dy]) => {
        const newX = dot.x + dx;
        const newY = dot.y + dy;

        if (
          newX >= 0 &&
          newX < 39 &&
          newY >= 0 &&
          newY < 32 &&
          !existingPositions.has(`${newX},${newY}`)
        ) {
          newDots.push({ x: newX, y: newY, type: opponentType });
          existingPositions.add(`${newX},${newY}`);
        }
      });
    });

    // Ajouter les nouveaux points et terminer la partie
    newDots.forEach((newDot) => {
      game.gameState.dots.push(newDot);
      io.to(gameId).emit("dotPlaced", newDot);
    });

    io.to(gameId).emit("checkCapturesAndEndGame");
  });

  // Gestion des demandes de match
  socket.on("requestMatch", (data) => {
    if (!socket.request.session?.username) return;

    const fromPlayer = socket.request.session.username;
    const toPlayer = data.toPlayer;

    let toPlayerSocketId = null;
    for (const [socketId, player] of onlinePlayers.entries()) {
      if (player.username === toPlayer) {
        toPlayerSocketId = socketId;
        break;
      }
    }

    if (toPlayerSocketId) {
      matchRequests.set(toPlayerSocketId, {
        from: fromPlayer,
        fromSocketId: socket.id,
      });

      io.to(toPlayerSocketId).emit("matchRequest", {
        fromPlayer: fromPlayer,
      });
    }
  });

  // Gestion de l'acceptation du match
  socket.on("acceptMatch", () => {
    const request = matchRequests.get(socket.id);
    if (!request) return;

    const gameId = Math.random().toString(36).substring(2, 8);
    console.log(`Nouvelle partie créée: ${gameId}`);

    games[gameId] = {
      players: [],
      gameState: {
        dots: [],
        scoreRed: 0,
        scoreBlue: 0,
        currentTurn: "player1",
        player1Name: null,
        player2Name: null,
        outlines: [],
        capturedEmpty: [],
        timers: {
          player1Time: 240,
          player2Time: 240,
          commonReflectionTime: 30,
          isReflectionPhase: true,
        },
      },
    };

    io.to(request.fromSocketId).emit("matchAccepted", gameId);
    io.to(socket.id).emit("matchAccepted", gameId);
    matchRequests.delete(socket.id);
  });

  // Gestion du refus du match
  socket.on("declineMatch", () => {
    const request = matchRequests.get(socket.id);
    if (!request) return;

    io.to(request.fromSocketId).emit(
      "matchDeclined",
      socket.request.session.username
    );
    matchRequests.delete(socket.id);
  });

  // Gestion de l'entrée dans une partie
  socket.on("joinGame", (gameId) => {
    console.log(`Tentative de rejoindre la partie ${gameId}`);

    if (!socket.request.session?.loggedin) {
        socket.emit("notAuthenticated");
        return;
    }

    if (!games[gameId]) {
        games[gameId] = {
            players: [],
            gameState: {
                dots: [],
                scoreRed: 0,
                scoreBlue: 0,
                currentTurn: "player1",
                player1Name: null,
                player2Name: null,
                outlines: [],
                capturedEmpty: [],
                timers: {
                    player1Time: 240,
                    player2Time: 240,
                    commonReflectionTime: 30,
                    isReflectionPhase: true
                }
            }
        };
    }

    const existingPlayer = games[gameId].players.find(
        p => p.username === socket.request.session.username
    );

    if (existingPlayer) {
        existingPlayer.id = socket.id;
        socket.join(gameId);

        // Préparer l'état du jeu avec les outlines formatées
        const formattedGameState = {
            ...games[gameId].gameState,
            dots: games[gameId].gameState.dots.map(dot => ({
                x: dot.x,
                y: dot.y,
                type: dot.type,
                captured: dot.captured
            })),
            outlines: games[gameId].gameState.outlines.map(outline => 
                outline.map(point => ({
                    x: point.x,
                    y: point.y,
                    type: point.type === "red" ? "red" : "blue",
                    c: point.type === "red" ? "#ed2939" : "#4267B2"
                }))
            )
        };

        socket.emit("gameJoined", {
            playerType: existingPlayer.type,
            gameState: formattedGameState,
            gameId: gameId
        });
        return;
    }

    if (games[gameId].players.length >= 2) {
        socket.emit("gameFull");
        return;
    }

    const playerType = games[gameId].players.length === 0 ? "player1" : "player2";
    const username = socket.request.session.username;

    if (playerType === "player1") {
        games[gameId].gameState.player1Name = username;
    } else {
        games[gameId].gameState.player2Name = username;
    }

    games[gameId].players.push({
        id: socket.id,
        type: playerType,
        username: username
    });

    // Mettre à jour le statut en partie
    if (onlinePlayers.has(socket.id)) {
        const player = onlinePlayers.get(socket.id);
        player.inGame = true;
        onlinePlayers.set(socket.id, player);
        io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    }

    socket.join(gameId);
    
    // Préparer l'état du jeu formaté pour le nouveau joueur
    const formattedGameState = {
        ...games[gameId].gameState,
        dots: games[gameId].gameState.dots.map(dot => ({
            x: dot.x,
            y: dot.y,
            type: dot.type,
            captured: dot.captured
        })),
        outlines: games[gameId].gameState.outlines.map(outline => 
            outline.map(point => ({
                x: point.x,
                y: point.y,
                type: point.type === "red" ? "red" : "blue",
                c: point.type === "red" ? "#ed2939" : "#4267B2"
            }))
        )
    };

    socket.emit("gameJoined", {
        playerType,
        gameState: formattedGameState,
        gameId: gameId
    });

    if (games[gameId].players.length === 2) {
        io.to(gameId).emit("gameStart", formattedGameState);
    }
});

  // Gestion du placement des points
  socket.on("placeDot", ({ gameId, x, y, type }) => {
    if (!games[gameId] || games[gameId].gameState.currentTurn !== type) return;

    const newDot = { x, y, type };
    const game = games[gameId];
    game.gameState.dots.push(newDot);
    game.gameState.currentTurn = type === "player1" ? "player2" : "player1";

    // Réinitialiser le temps de réflexion à chaque tour
    game.gameState.timers.commonReflectionTime = 30;
    game.gameState.timers.isReflectionPhase = true;

    io.to(gameId).emit("dotPlaced", newDot);
    io.to(gameId).emit("turnChange", game.gameState.currentTurn);
  });

  // Gestion de la mise à jour des scores
  socket.on("updateScore", ({
    gameId,
    scoreRed,
    scoreBlue,
    dots,
    outlines,
    capturedEmpty,
    timers
}) => {
    if (!games[gameId]) return;

    // Mettre à jour les scores et l'état du jeu
    const game = games[gameId];
    game.gameState.scoreRed = scoreRed;
    game.gameState.scoreBlue = scoreBlue;

    // Mettre à jour l'état complet du jeu si fourni
    if (dots) {
        game.gameState.dots = dots.map(dot => ({
            x: dot.x,
            y: dot.y,
            type: dot.type,
            captured: dot.captured
        }));
    }

    if (outlines) {
        game.gameState.outlines = outlines.map(outline => 
            outline.map(point => ({
                x: point.x,
                y: point.y,
                type: point.type === "red" ? "red" : "blue",
                c: point.type === "red" ? "#ed2939" : "#4267B2"
            }))
        );
    }

    if (capturedEmpty) {
        game.gameState.capturedEmpty = capturedEmpty;
    }

    if (timers) {
        game.gameState.timers = {
            player1Time: timers.player1Time,
            player2Time: timers.player2Time,
            commonReflectionTime: timers.commonReflectionTime,
            isReflectionPhase: timers.isReflectionPhase
        };
    }

    // Créer un état formaté pour l'émission
    const formattedGameState = {
        ...game.gameState,
        dots: game.gameState.dots,
        outlines: game.gameState.outlines,
        capturedEmpty: game.gameState.capturedEmpty,
        timers: game.gameState.timers,
        scoreRed: game.gameState.scoreRed,
        scoreBlue: game.gameState.scoreBlue
    };

    // Émettre l'état complet mis à jour
    io.to(gameId).emit("scoreUpdated", formattedGameState);

    // Gestion de la base de données pour les scores des joueurs
    if (game.players.length === 2 && (scoreRed > 0 || scoreBlue > 0)) {
        const winner = scoreRed > scoreBlue ? game.players[0] : game.players[1];

        if (winner) {
            const playerSocket = io.sockets.sockets.get(winner.id);
            if (playerSocket?.request?.session?.username) {
                db.query(
                    "UPDATE users SET score = score + ?, games_played = games_played + 1 WHERE username = ?",
                    [1, playerSocket.request.session.username],
                    (err) => {
                        if (err) console.error("Error updating winner score:", err);
                    }
                );
            }
        }
    }
});

  // Ajouter un gestionnaire pour la mise à jour de l'état des timers
  socket.on("updateTimers", ({ gameId, timers }) => {
    if (games[gameId]) {
      games[gameId].gameState.timers = {
        player1Time: timers.player1Time,
        player2Time: timers.player2Time,
        commonReflectionTime: timers.commonReflectionTime,
        isReflectionPhase: timers.isReflectionPhase,
      };

      // Émettre la mise à jour à tous les joueurs de la partie
      io.to(gameId).emit("timerUpdate", games[gameId].gameState.timers);
    }
  });
  // Gestion de la déconnexion
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    const playerInfo = onlinePlayers.get(socket.id);
    if (!playerInfo) return;

    const username = playerInfo.username;

    // Créer un timeout pour la déconnexion
    const timeout = setTimeout(() => {
      // Vérifier si le joueur n'est pas déjà reconnecté
      const reconnected = Array.from(onlinePlayers.values()).some(
        (p) => p.username === username && p.id !== socket.id
      );

      if (!reconnected) {
        onlinePlayers.delete(socket.id);
        io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));

        // Gérer la déconnexion dans les parties
        for (const [gameId, game] of Object.entries(games)) {
          const playerIndex = game.players.findIndex((p) => p.id === socket.id);
          if (playerIndex !== -1) {
            game.players.splice(playerIndex, 1);
            if (game.players.length === 1) {
              io.to(gameId).emit("playerDisconnected");
            } else if (game.players.length === 0) {
              delete games[gameId];
            }
          }
        }
      }
    }, 5000); // 5 secondes de délai

    userDisconnectTimeouts.set(username, timeout);
  });

  // Gestion de la tentative de reconnexion
  socket.on("reconnect_attempt", () => {
    const username = socket.request.session?.username;
    if (username && userDisconnectTimeouts.has(username)) {
      clearTimeout(userDisconnectTimeouts.get(username));
      userDisconnectTimeouts.delete(username);
    }
  });

  // Nettoyage lors de la déconnexion explicite
  socket.on("logout", () => {
    const playerInfo = onlinePlayers.get(socket.id);
    if (playerInfo) {
      const username = playerInfo.username;
      if (userDisconnectTimeouts.has(username)) {
        clearTimeout(userDisconnectTimeouts.get(username));
        userDisconnectTimeouts.delete(username);
      }
      onlinePlayers.delete(socket.id);
      io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
    }
  });
});

// Démarrage du serveur
http.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});