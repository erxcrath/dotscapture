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
    secret: 'secret', // Changez ceci pour une valeur sécurisée
    resave: false,
    saveUninitialized: true
});

// Utiliser la session dans Express
app.use(sessionMiddleware);

// Utilisation du middleware pour analyser les formulaires
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware d'authentification
function requireLogin(req, res, next) {
    if (req.session.loggedin) {
        return next();
    } else {
        res.redirect('/login');
    }
}

// Appliquer le middleware d'authentification à toutes les routes sauf login et register
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
    password: '', // Mettez ici votre mot de passe MySQL
    database: 'circle_game' // Assurez-vous que cette base de données existe
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('MySQL Connected...');
});

const games = {};

// Routes
app.get('/', (req, res) => {
    if (req.session.loggedin) {
        res.redirect('/game');
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

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if(err) {
            console.log(err);
        } else {
            res.redirect('/login');
        }
    });
});

// Servir les fichiers statiques après la définition des routes
app.use(express.static('public'));

// Attacher la session à Socket.IO
io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Gestion des connexions Socket.IO
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('joinGame', (gameId) => {
        const session = socket.request.session;
        if (session.loggedin) {
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
        }
    });

    socket.on('disconnect', () => {
        console.log(`User ${socket.id} disconnected`);

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