require('dotenv').config();
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const mysql = require("mysql2");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser"); // Ajout de cette ligne

// Configuration de la base de données
const dbConfig = {
  host: process.env.MYSQLHOST || "localhost",
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "",
  database: process.env.MYSQLDATABASE || "faritanyX",
  port: process.env.MYSQLPORT || 3306
};


/*const dbConfig = {
  host: "localhost",
  user: "root",
  password: "",
  database: "faritanyX",
  port: 3306,
};
*/
// Créer la connexion à la base de données
const db = mysql.createConnection(dbConfig);
// Créer le store de session
const sessionStore = new MySQLStore(dbConfig);

// Configuration de la session
const sessionMiddleware = session({
  secret: "secret",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false, // Mettre à true si vous utilisez HTTPS
    maxAge: 24 * 60 * 60 * 1000, // 24 heures
  },
});

// Constantes pour le calcul ELO
const ELO_K_FACTOR = 32;

// Configuration du port
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static("public"));
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Connexion à la base de données
db.connect((err) => {
  if (err) {
    console.error("Erreur de connexion à la base de données :", err);
    return;
  }
  console.log("Connecté avec succès à la base de données");

  // Créer la table users
  // Créer la table users
  const createUsersTable = `
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    score INT DEFAULT 0,
    games_played INT DEFAULT 0
  );
`;

const createGamesHistoryTable = `
  CREATE TABLE IF NOT EXISTS games_history (
    id INT(11) NOT NULL AUTO_INCREMENT,
    game_id VARCHAR(255) NOT NULL,
    player_username VARCHAR(255) NOT NULL,
    opponent_username VARCHAR(255) NOT NULL,
    result FLOAT NOT NULL,
    player_elo_before INT NOT NULL,
    player_elo_after INT NOT NULL,
    end_reason VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  );
`;

  db.query(createUsersTable, (err) => {
    if (err) {
      console.error("Erreur lors de la création de la table:", err);
      return;
    }
    console.log("Table users vérifiée/créée");
  });


db.query(createGamesHistoryTable, (err) => {
  if (err) console.error("Erreur lors de la création de la table games_history:", err);
  else console.log("Table games_history créée avec succès.");
});
});

// Gestion des erreurs de connexion
db.on("error", (err) => {
  console.error("Erreur de base de données :", err);
  if (err.code === "PROTOCOL_CONNECTION_LOST") {
    console.log("Tentative de reconnexion à la base de données...");
  }
});

// Garder une trace des joueurs en ligne
const onlinePlayers = new Map();
const games = {};

// Ajouter ces variables au début du fichier, après la déclaration des autres variables
const matchRequests = new Map(); // Pour stocker les demandes de match en cours

// Configurer correctement les fichiers statiques
app.use(express.static("public"));

// Utiliser la session dans Express
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware d'authentification
function requireLogin(req, res, next) {
  if (req.session && req.session.loggedin) {
    next();
  } else {
    // Stocker l'URL demandée pour redirection après login
    req.session.returnTo = req.originalUrl;
    res.redirect("/login");
  }
}

// Fonction de calcul ELO
function calculateNewElo(playerElo, opponentElo, score) {
  const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(playerElo + ELO_K_FACTOR * (score - expectedScore));
}

// Middleware d'authentification simplifié
app.use((req, res, next) => {
  // Liste des chemins autorisés sans authentification
  const publicPaths = ["/login", "/register"];

  // Autoriser l'accès aux fichiers statiques et aux chemins publics
  if (
    req.path.startsWith("/css") ||
    req.path.startsWith("/js") ||
    req.path.startsWith("/public") ||
    publicPaths.includes(req.path)
  ) {
    return next();
  }

  // Vérifier l'authentification
  if (req.session && req.session.loggedin) {
    return next();
  }

  // Rediriger vers login si non authentifié
  res.redirect("/login");
});

// Routes principales
app.get("/", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.redirect("/accueil");
  } else {
    res.redirect("/login");
  }
});

// Ajouter des logs pour le débogage
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  console.log("Tentative de connexion pour:", username);

  if (username && password) {
    db.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
      (err, results) => {
        if (err) {
          console.error("Erreur SQL:", err);
          throw err;
        }
        if (results.length > 0) {
          bcrypt.compare(password, results[0].password, (err, match) => {
            if (match) {
              console.log("Connexion réussie pour:", username);
              req.session.loggedin = true;
              req.session.username = username;
              req.session.save((err) => {
                if (err) {
                  console.error("Erreur de sauvegarde de session:", err);
                  res.status(500).send("Erreur de session");
                } else {
                  res.redirect("/accueil");
                }
              });
            } else {
              console.log("Mot de passe incorrect pour:", username);
              res.status(401).send("Incorrect password!");
            }
          });
        } else {
          console.log("Utilisateur non trouvé:", username);
          res.status(404).send("User not found");
        }
      }
    );
  } else {
    console.log("Données de connexion manquantes");
    res.status(400).send("Please enter username and password");
  }
});


app.get("/accueil", (req, res) => {
  console.log("Tentative d'accès à /accueil");
  console.log("Session:", req.session);
  console.log("LoggedIn:", req.session?.loggedin);
  console.log("Directory:", __dirname);

  if (req.session && req.session.loggedin) {
    const filePath = __dirname + "/public/accueil.html";
    console.log("Chemin du fichier:", filePath);

    // Vérifier si le fichier existe
    if (require("fs").existsSync(filePath)) {
      console.log("Le fichier accueil.html existe");
      res.sendFile(filePath);
    } else {
      console.log("Le fichier accueil.html n'existe pas");
      res.status(404).send("Page non trouvée");
    }
  } else {
    console.log("Utilisateur non authentifié, redirection vers /login");
    res.redirect("/login");
  }
});

// Ajouter cette route dans votre section des routes
app.get("/profile/:username", (req, res) => {
  if (!req.session || !req.session.loggedin) {
    return res.redirect("/login");
  }
  
  const username = req.params.username;
  res.sendFile(__dirname + "/public/profile.html");
});

// Remplacer la route API du profil par celle-ci
app.get("/api/profile/:username", (req, res) => {
  const username = req.params.username;
  
  // Requête pour les données utilisateur
  db.query(
    "SELECT username, score, games_played FROM users WHERE username = ?",
    [username],
    (err, userData) => {
      if (err) {
        console.error("Erreur lors de la récupération des données utilisateur:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }

      // Requête pour l'historique des matches avec les scores ELO
      db.query(
        `SELECT 
          gh.game_id,
          gh.opponent_username,
          gh.result,
          gh.end_reason,
          gh.created_at,
          gh.player_elo_before,
          gh.player_elo_after,
          (gh.player_elo_after - gh.player_elo_before) as elo_change
        FROM games_history gh
        WHERE gh.player_username = ?
        ORDER BY gh.created_at DESC 
        LIMIT 10`,
        [username],
        (err, matchHistory) => {
          if (err) {
            console.error("Erreur lors de la récupération de l'historique:", err);
            return res.status(500).json({ error: "Erreur serveur" });
          }

          const stats = {
            totalGames: userData[0].games_played,
            wins: matchHistory.filter(match => match.result === 1).length,
            losses: matchHistory.filter(match => match.result === 0).length,
            currentElo: userData[0].score,
            winRate: userData[0].games_played > 0 
              ? Math.round((matchHistory.filter(match => match.result === 1).length / userData[0].games_played) * 100)
              : 0
          };

          res.json({
            user: userData[0],
            stats,
            matchHistory
          });
        }
      );
    }
  );
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.get("/register", (req, res) => {
  res.sendFile(__dirname + "/public/register.html");
});

app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (username && password) {
    bcrypt.hash(password, 8, (err, hash) => {
      if (err) throw err;
      // Modifier la requête pour inclure le score initial de 1200
      db.query(
        "INSERT INTO users (username, password, score, games_played) VALUES (?, ?, 1200, 0)",
        [username, hash],
        (err) => {
          if (err) {
            return res.status(500).send("Error registering user");
          }
          res.redirect("/login");
        }
      );
    });
  } else {
    res.status(400).send("Please enter username and password");
  }
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (username && password) {
    db.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
      (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
          bcrypt.compare(password, results[0].password, (err, match) => {
            if (match) {
              req.session.loggedin = true;
              req.session.username = username;
              res.redirect("/accueil");
            } else {
              res.status(401).send("Incorrect password!");
            }
          });
        } else {
          res.status(404).send("User not found");
        }
      }
    );
  } else {
    res.status(400).send("Please enter username and password");
  }
});

app.get("/game", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.sendFile(__dirname + "/public/game.html");
  } else {
    res.redirect("/login");
  }
});

app.get("/logout", (req, res) => {
  if (req.session.username) {
    // Trouver et supprimer le joueur de la liste des joueurs en ligne
    for (const [socketId, player] of onlinePlayers.entries()) {
      if (player.username === req.session.username) {
        onlinePlayers.delete(socketId);
        io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
        break;
      }
    }
  }

  req.session.destroy((err) => {
    if (err) {
      console.log(err);
    }
    res.redirect("/login");
  });
});

// Ajouter une route pour vérifier l'état de la session
app.get("/check-session", (req, res) => {
  if (req.session && req.session.loggedin) {
    res.json({ authenticated: true, username: req.session.username });
  } else {
    res.json({ authenticated: false });
  }
});

// Route de débogage
app.get("/debug-session", (req, res) => {
  res.json({
    session: req.session,
    loggedin: req.session?.loggedin,
    username: req.session?.username,
  });
});

// Attacher la session à Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Gestion des connexions Socket.IO
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Map pour stocker les timeouts de déconnexion par utilisateur
  const userDisconnectTimeouts = new Map();

  // Ajouter le joueur connecté à la liste des joueurs en ligne
  if (socket.request.session?.username) {
    const username = socket.request.session.username;

    // Annuler tout timeout de déconnexion existant pour cet utilisateur
    if (userDisconnectTimeouts.has(username)) {
      clearTimeout(userDisconnectTimeouts.get(username));
      userDisconnectTimeouts.delete(username);
    }

    // Mettre à jour les connexions existantes
    for (const [oldSocketId, player] of onlinePlayers.entries()) {
      if (player.username === username) {
        onlinePlayers.delete(oldSocketId);
        break;
      }
    }

    // Ajouter le nouveau joueur
    onlinePlayers.set(socket.id, {
      username: username,
      inGame: false,
      id: socket.id,
    });
    io.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));

    // Rejoindre automatiquement la partie en cours
    for (const [gameId, game] of Object.entries(games)) {
      const existingPlayer = game.players.find((p) => p.username === username);
      if (existingPlayer) {
        existingPlayer.id = socket.id;
        socket.join(gameId);
        socket.emit("gameJoined", {
          playerType: existingPlayer.type,
          gameState: game.gameState,
          gameId: gameId,
        });
        if (game.players.length === 2) {
          socket.emit("gameStart", game.gameState);
        }
        break;
      }
    }
  }

  // Gestion des joueurs en ligne
  socket.on("requestOnlinePlayers", () => {
    socket.emit("updateOnlinePlayers", Array.from(onlinePlayers.values()));
  });

  // Gestion du classement
  socket.on("requestLeaderboard", () => {
    db.query(
      "SELECT username, score, games_played FROM users ORDER BY score DESC LIMIT 10",
      (err, results) => {
        if (err) {
          console.error("Erreur lors de la récupération du classement:", err);
          return;
        }
        socket.emit("updateLeaderboard", results);
      }
    );
  });

  // Dans server.js, remplacer le gestionnaire d'abandon existant
// Dans server.js, modifions le gestionnaire d'abandon
socket.on('abandonGame', async ({ gameId, player }) => {
  const game = games[gameId];
  if (!game) return;

  try {
      const winner = player === 'player1' ? 'player2' : 'player1';
      const player1 = game.players.find(p => p.type === 'player1');
      const player2 = game.players.find(p => p.type === 'player2');

      // Récupérer les scores ELO actuels
      const [player1Data, player2Data] = await Promise.all([
          queryAsync('SELECT score FROM users WHERE username = ?', [player1.username]),
          queryAsync('SELECT score FROM users WHERE username = ?', [player2.username])
      ]);

      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;

      const player1Score = winner === 'player1' ? 1 : 0;
      const player2Score = 1 - player1Score;

      const newPlayer1Elo = calculateNewElo(player1Elo, player2Elo, player1Score);
      const newPlayer2Elo = calculateNewElo(player2Elo, player1Elo, player2Score);

      // Démarrer une transaction
      await queryAsync('START TRANSACTION');

      try {
          // Insérer dans l'historique
          await queryAsync(
            'INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                gameId, 
                player1.username, 
                player2.username, 
                player1Score, 
                player1Elo,       // ELO avant
                newPlayer1Elo,    // ELO après
                'abandonGame'
            ]
        );
        
        // Faire la même chose pour le joueur 2
        await queryAsync(
            'INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                gameId, 
                player2.username, 
                player1.username, 
                player2Score,
                player2Elo,       // ELO avant
                newPlayer2Elo,    // ELO après
                'abandonGame'
            ]
        );

          // Mettre à jour les scores
          await Promise.all([
              queryAsync(
                  'UPDATE users SET score = ? WHERE username = ?',
                  [newPlayer1Elo, player1.username]
              ),
              queryAsync(
                  'UPDATE users SET score = ? WHERE username = ?',
                  [newPlayer2Elo, player2.username]
              )
          ]);

          // Mettre à jour games_played en se basant sur games_history
          await queryAsync(`
              UPDATE users u 
              SET games_played = (
                  SELECT COUNT(*) 
                  FROM games_history 
                  WHERE player_username = u.username
                  OR opponent_username = u.username
              )
              WHERE username IN (?, ?)
          `, [player1.username, player2.username]);

          await queryAsync('COMMIT');

          // Envoyer les résultats
          io.to(gameId).emit('gameEnded', {
              reason: 'abandon',
              winner: winner,
              message: `${player === 'player1' ? 'Joueur 1' : 'Joueur 2'} a abandonné la partie`,
              finalScores: {
                  player1: {
                      username: player1.username,
                      oldElo: player1Elo,
                      newElo: newPlayer1Elo,
                      scoreDiff: newPlayer1Elo - player1Elo
                  },
                  player2: {
                      username: player2.username,
                      oldElo: player2Elo,
                      newElo: newPlayer2Elo,
                      scoreDiff: newPlayer2Elo - player2Elo
                  }
              }
          });

          // Nettoyer la partie
          delete games[gameId];

      } catch (dbError) {
          await queryAsync('ROLLBACK');
          throw dbError;
      }

  } catch (error) {
      console.error('Erreur lors de la gestion de l\'abandon:', error);
  }
});
// Gestionnaire pour le timeout
socket.on('timeoutGame', async ({ gameId, loser, winner }) => {
  const game = games[gameId];
  if (!game) return;

  try {
      const player1 = game.players.find(p => p.type === 'player1');
      const player2 = game.players.find(p => p.type === 'player2');

      const [player1Data, player2Data] = await Promise.all([
          queryAsync('SELECT score FROM users WHERE username = ?', [player1.username]),
          queryAsync('SELECT score FROM users WHERE username = ?', [player2.username])
      ]);

      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;

      const player1Score = winner === 'player1' ? 1 : 0;
      const player2Score = 1 - player1Score;

      const newPlayer1Elo = calculateNewElo(player1Elo, player2Elo, player1Score);
      const newPlayer2Elo = calculateNewElo(player2Elo, player1Elo, player2Score);

      // Démarrer une transaction
      await queryAsync('START TRANSACTION');

      try {
          // Insérer dans l'historique
          await queryAsync(
            'INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                gameId, 
                player1.username, 
                player2.username, 
                player1Score, 
                player1Elo,       // ELO avant
                newPlayer1Elo,    // ELO après
                'timeoutGame'
            ]
        );
        
        // Faire la même chose pour le joueur 2
        await queryAsync(
            'INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                gameId, 
                player2.username, 
                player1.username, 
                player2Score,
                player2Elo,       // ELO avant
                newPlayer2Elo,    // ELO après
                'timeoutGame'
            ]
        );

          // Mettre à jour les scores
          await Promise.all([
              queryAsync(
                  'UPDATE users SET score = ? WHERE username = ?',
                  [newPlayer1Elo, player1.username]
              ),
              queryAsync(
                  'UPDATE users SET score = ? WHERE username = ?',
                  [newPlayer2Elo, player2.username]
              )
          ]);

          // Mettre à jour games_played en se basant sur games_history
          await queryAsync(`
              UPDATE users u 
              SET games_played = (
                  SELECT COUNT(*) 
                  FROM games_history 
                  WHERE player_username = u.username
                  OR opponent_username = u.username
              )
              WHERE username IN (?, ?)
          `, [player1.username, player2.username]);

          await queryAsync('COMMIT');

          io.to(gameId).emit('gameEnded', {
              reason: 'timeout',
              winner: winner,
              message: `Partie terminée par timeout`,
              finalScores: {
                  player1: {
                      username: player1.username,
                      oldElo: player1Elo,
                      newElo: newPlayer1Elo,
                      scoreDiff: newPlayer1Elo - player1Elo
                  },
                  player2: {
                      username: player2.username,
                      oldElo: player2Elo,
                      newElo: newPlayer2Elo,
                      scoreDiff: newPlayer2Elo - player2Elo
                  }
              }
          });

          delete games[gameId];

      } catch (dbError) {
          await queryAsync('ROLLBACK');
          throw dbError;
      }

  } catch (error) {
      console.error('Erreur lors de la gestion du timeout:', error);
  }
});
  // Gestion de la mise à terre
  // Modification de l'événement miseATerre pour éviter le double comptage
  socket.on("miseATerre", async ({ gameId }) => {
    if (!games[gameId]) return;
  
    const game = games[gameId];
    // Vérifier si la partie est déjà terminée
    if (game.gameEnded) return;
    
    // Marquer immédiatement la partie comme terminée pour éviter les doublons
    game.gameEnded = true;
    
    const currentPlayer = game.players.find((p) => p.id === socket.id);
    if (!currentPlayer || currentPlayer.type !== game.gameState.currentTurn) {
        game.gameEnded = false; // Réinitialiser si le joueur n'est pas valide
        return;
    }
  
    try {
        // Première étape : placer tous les nouveaux points
        const playerDots = game.gameState.dots.filter(dot => dot.type === currentPlayer.type);
        const opponentType = currentPlayer.type === "player1" ? "player2" : "player1";
        const newDots = [];
        const existingPositions = new Set(game.gameState.dots.map(dot => `${dot.x},${dot.y}`));
  
        playerDots.forEach((dot) => {
            [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dx, dy]) => {
                const newX = dot.x + dx;
                const newY = dot.y + dy;
  
                if (newX >= 0 && newX < 39 && newY >= 0 && newY < 32 && !existingPositions.has(`${newX},${newY}`)) {
                    newDots.push({ x: newX, y: newY, type: opponentType });
                    existingPositions.add(`${newX},${newY}`);
                }
            });
        });
  
        // Ajouter les points à l'état du jeu
        game.gameState.dots.push(...newDots);
  
        // Notifier les points
        for (const newDot of newDots) {
            io.to(gameId).emit("dotPlaced", newDot);
        }
  
        // Attendre pour les calculs
        await new Promise(resolve => setTimeout(resolve, 100));
  
        // Deuxième étape : traiter les scores et la fin de partie
        const player1 = game.players.find(p => p.type === 'player1');
        const player2 = game.players.find(p => p.type === 'player2');
  
        // Récupérer les scores ELO actuels
        const [player1Data, player2Data] = await Promise.all([
            queryAsync('SELECT score FROM users WHERE username = ?', [player1.username]),
            queryAsync('SELECT score FROM users WHERE username = ?', [player2.username])
        ]);
  
        const player1Elo = player1Data[0]?.score || 1200;
        const player2Elo = player2Data[0]?.score || 1200;
  
        // Déterminer le gagnant
        const player1Score = game.gameState.scoreRed > game.gameState.scoreBlue ? 1 : 0;
        const player2Score = 1 - player1Score;
  
        // Calculer les nouveaux scores ELO
        const newPlayer1Elo = calculateNewElo(player1Elo, player2Elo, player1Score);
        const newPlayer2Elo = calculateNewElo(player2Elo, player1Elo, player2Score);
  
        // Transaction unique pour l'enregistrement
        await queryAsync('START TRANSACTION');
  
        try {
            // Vérifier si la partie est déjà enregistrée
            const historyExists = await queryAsync(
                'SELECT 1 FROM games_history WHERE game_id = ? LIMIT 1',
                [gameId]
            );
  
            if (!historyExists.length) {
              await Promise.all([
                // Mise à jour des scores uniquement
                queryAsync(
                    'UPDATE users SET score = ? WHERE username = ?',
                    [newPlayer1Elo, player1.username]
                ),
                queryAsync(
                    'UPDATE users SET score = ? WHERE username = ?',
                    [newPlayer2Elo, player2.username]
                ),
                // Enregistrer l'historique pour le joueur 1
                queryAsync(
                    'INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [gameId, player1.username, player2.username, player1Score, player1Elo, newPlayer1Elo, 'miseATerre']
                ),
                // Enregistrer l'historique pour le joueur 2
                queryAsync(
                    'INSERT INTO games_history (game_id, player_username, opponent_username, result, player_elo_before, player_elo_after, end_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [gameId, player2.username, player1.username, player2Score, player2Elo, newPlayer2Elo, 'miseATerre']
                )
            ]);
          
              // Mettre à jour games_played APRÈS en se basant sur games_history
              await queryAsync(`
                  UPDATE users u 
                  SET games_played = (
                      SELECT COUNT(*) 
                      FROM games_history 
                      WHERE player_username = u.username
                      OR opponent_username = u.username
                  )
                  WHERE username IN (?, ?)
              `, [player1.username, player2.username]);
          
              await queryAsync('COMMIT');
          
          } else {
              await queryAsync('ROLLBACK');
          }
  
            // Envoyer le résultat final
            io.to(gameId).emit('gameEnded', {
                reason: 'miseATerre',
                winner: player1Score > player2Score ? 'player1' : 'player2',
                message: 'Partie terminée par mise à terre',
                finalScores: {
                    player1: {
                        username: player1.username,
                        oldElo: player1Elo,
                        newElo: newPlayer1Elo,
                        scoreDiff: newPlayer1Elo - player1Elo
                    },
                    player2: {
                        username: player2.username,
                        oldElo: player2Elo,
                        newElo: newPlayer2Elo,
                        scoreDiff: newPlayer2Elo - player2Elo
                    }
                }
            });
  
            // Nettoyer la partie
            delete games[gameId];
  
        } catch (dbError) {
            await queryAsync('ROLLBACK');
            throw dbError;
        }
  
    } catch (error) {
        console.error('Erreur lors de la mise à terre:', error);
        game.gameEnded = false;
        io.to(gameId).emit('gameError', {
            message: 'Une erreur est survenue lors de la mise à terre'
        });
    }
  });
  
  
  socket.on('gameOver', async ({ gameId, winner, reason }) => {
    await handleGameEnd(gameId, winner, reason);
    
    io.to(gameId).emit('gameEnded', {
      reason: reason,
      winner: winner,
      message: `Partie terminée - ${reason}`
    });
  });

  // Fonction de gestion de fin de partie
// Modifier la fonction handleGameEnd
async function handleGameEnd(gameId, winner, reason) {
  const game = games[gameId];
  if (!game || game.gameEnded) return; // Empêcher le double comptage
  
  try {
      // Marquer la partie comme terminée
      game.gameEnded = true;
      
      const player1 = game.players.find(p => p.type === 'player1');
      const player2 = game.players.find(p => p.type === 'player2');
 
      const [player1Data, player2Data] = await Promise.all([
          queryAsync('SELECT score FROM users WHERE username = ?', [player1.username]),
          queryAsync('SELECT score FROM users WHERE username = ?', [player2.username])
      ]);
 
      const player1Elo = player1Data[0]?.score || 1200;
      const player2Elo = player2Data[0]?.score || 1200;
 
      // Déterminer les scores selon la raison
      let p1Score, p2Score;
      switch (reason) {
          case 'miseATerre':
              p1Score = game.gameState.scoreRed > game.gameState.scoreBlue ? 1 : 0;
              p2Score = 1 - p1Score;
              break;
          case 'abandon':
              p1Score = winner === 'player1' ? 1 : 0;
              p2Score = 1 - p1Score;
              break;
          case 'timeout':
              p1Score = winner === 'player1' ? 1 : 0;
              p2Score = 1 - p1Score;
              break;
          default:
              p1Score = 0.5;
              p2Score = 0.5;
      }
 
      const newPlayer1Elo = calculateNewElo(player1Elo, player2Elo, p1Score);
      const newPlayer2Elo = calculateNewElo(player2Elo, player1Elo, p2Score);
 
      await queryAsync('START TRANSACTION');
 
      try {
          // Mettre à jour les scores et enregistrer l'historique
          await Promise.all([
              // Mise à jour des scores uniquement
              queryAsync(
                  'UPDATE users SET score = ? WHERE username = ?',
                  [newPlayer1Elo, player1.username]
              ),
              queryAsync(
                  'UPDATE users SET score = ? WHERE username = ?',
                  [newPlayer2Elo, player2.username]
              ),
              // Enregistrer dans l'historique
              queryAsync(
                  'INSERT INTO games_history (game_id, player_username, opponent_username, result, end_reason) VALUES (?, ?, ?, ?, ?)',
                  [gameId, player1.username, player2.username, p1Score, reason]
              )
          ]);
 
          // Mettre à jour games_played en comptant à la fois comme joueur et comme adversaire
          await queryAsync(`
              UPDATE users u 
              SET games_played = (
                  SELECT COUNT(*) 
                  FROM games_history 
                  WHERE player_username = u.username 
                  OR opponent_username = u.username
              )
              WHERE username IN (?, ?)
          `, [player1.username, player2.username]);
 
          await queryAsync('COMMIT');
 
          // Nettoyer la partie
          delete games[gameId];
          
          return {
              player1: { oldElo: player1Elo, newElo: newPlayer1Elo },
              player2: { oldElo: player2Elo, newElo: newPlayer2Elo }
          };
 
      } catch (dbError) {
          await queryAsync('ROLLBACK');
          throw dbError;
      }
 
  } catch (error) {
      console.error('Erreur lors de la fin de partie:', error);
      throw error;
  }
 }
// Fonction pour gérer la reconnexion
function handleDisconnect() {
  db.on('error', function(err) {
      console.log('db error', err);
      if(err.code === 'PROTOCOL_CONNECTION_LOST') {
          handleDisconnect();
      } else {
          throw err;
      }
  });
}

handleDisconnect();

// Fonction pour vérifier/rétablir la connexion avant chaque requête
function ensureConnection() {
  return new Promise((resolve, reject) => {
      if (db.state === 'disconnected') {
          db.connect(function(err) {
              if (err) {
                  reject(err);
              } else {
                  resolve();
              }
          });
      } else {
          resolve();
      }
  });
}

// Modifier la fonction queryAsync
function queryAsync(sql, values) {
  return ensureConnection()
      .then(() => {
          return new Promise((resolve, reject) => {
              db.query(sql, values, (err, results) => {
                  if (err) reject(err);
                  else resolve(results);
              });
          });
      });
}

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
            isReflectionPhase: true,
          },
        },
      };
    }

    const existingPlayer = games[gameId].players.find(
      (p) => p.username === socket.request.session.username
    );

    if (existingPlayer) {
      existingPlayer.id = socket.id;
      socket.join(gameId);

      // Préparer l'état du jeu avec les outlines formatées
      const formattedGameState = {
        ...games[gameId].gameState,
        dots: games[gameId].gameState.dots.map((dot) => ({
          x: dot.x,
          y: dot.y,
          type: dot.type,
          captured: dot.captured,
        })),
        outlines: games[gameId].gameState.outlines.map((outline) =>
          outline.map((point) => ({
            x: point.x,
            y: point.y,
            type: point.type === "red" ? "red" : "blue",
            c: point.type === "red" ? "#ed2939" : "#4267B2",
          }))
        ),
      };

      socket.emit("gameJoined", {
        playerType: existingPlayer.type,
        gameState: formattedGameState,
        gameId: gameId,
      });
      return;
    }

    if (games[gameId].players.length >= 2) {
      socket.emit("gameFull");
      return;
    }

    const playerType =
      games[gameId].players.length === 0 ? "player1" : "player2";
    const username = socket.request.session.username;

    if (playerType === "player1") {
      games[gameId].gameState.player1Name = username;
    } else {
      games[gameId].gameState.player2Name = username;
    }

    games[gameId].players.push({
      id: socket.id,
      type: playerType,
      username: username,
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
      dots: games[gameId].gameState.dots.map((dot) => ({
        x: dot.x,
        y: dot.y,
        type: dot.type,
        captured: dot.captured,
      })),
      outlines: games[gameId].gameState.outlines.map((outline) =>
        outline.map((point) => ({
          x: point.x,
          y: point.y,
          type: point.type === "red" ? "red" : "blue",
          c: point.type === "red" ? "#ed2939" : "#4267B2",
        }))
      ),
    };

    socket.emit("gameJoined", {
      playerType,
      gameState: formattedGameState,
      gameId: gameId,
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
  socket.on(
    "updateScore",
    ({
      gameId,
      scoreRed,
      scoreBlue,
      dots,
      outlines,
      capturedEmpty,
      timers,
    }) => {
      if (!games[gameId]) return;

      // Mettre à jour les scores et l'état du jeu
      const game = games[gameId];
      game.gameState.scoreRed = scoreRed;
      game.gameState.scoreBlue = scoreBlue;

      // Mettre à jour l'état complet du jeu si fourni
      if (dots) {
        game.gameState.dots = dots.map((dot) => ({
          x: dot.x,
          y: dot.y,
          type: dot.type,
          captured: dot.captured,
        }));
      }

      if (outlines) {
        game.gameState.outlines = outlines.map((outline) =>
          outline.map((point) => ({
            x: point.x,
            y: point.y,
            type: point.type === "red" ? "red" : "blue",
            c: point.type === "red" ? "#ed2939" : "#4267B2",
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
          isReflectionPhase: timers.isReflectionPhase,
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
        scoreBlue: game.gameState.scoreBlue,
      };

      // Émettre l'état complet mis à jour
      io.to(gameId).emit("scoreUpdated", formattedGameState);

      // Gestion de la base de données pour les scores des joueurs
      // Remplacer cette partie dans "updateScore"
if (game.players.length === 2 && (scoreRed > 0 || scoreBlue > 0)) {
  const winner = scoreRed > scoreBlue ? game.players[0] : game.players[1];
  if (winner) {
      const playerSocket = io.sockets.sockets.get(winner.id);
      if (playerSocket?.request?.session?.username) {
          // Uniquement mettre à jour le score, pas games_played
          db.query(
              "UPDATE users SET score = score + ? WHERE username = ?",
              [1, playerSocket.request.session.username],
              (err) => {
                  if (err) console.error("Error updating winner score:", err);
              }
          );
      }
  }
}
    }
  );

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

// Lancer le serveur
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
