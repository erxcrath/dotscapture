// Variables globales
const MAX_X = 39;
const MAX_Y = 32;
const Scale = Math.min((window.innerWidth - 100) / MAX_X, (window.innerHeight - 300) / MAX_Y);
const WIDTH = Scale * (MAX_X - 1);
const HEIGHT = Scale * (MAX_Y - 1);
const DOTSIZE = Scale / 1.8;
const LINEWEIGHT = DOTSIZE / 8;

// Définition des zones de départ
const STARTING_ZONE_SIZE = 5.0000000009;
const CENTER_ZONE = {
    x: Math.floor((MAX_X - STARTING_ZONE_SIZE) / 2),
    y: Math.floor((MAX_Y - STARTING_ZONE_SIZE) / 2),
    width: STARTING_ZONE_SIZE,
    height: STARTING_ZONE_SIZE
};

// Variables du jeu
let svgElement;
let render = [];
let outlines = [];
let shapes = [];
let reddots = [];
let bluedots = [];
let scoreRed = 0;
let scoreBlue = 0;
let dragging = false;
let capturedEmpty = [];
let currentTurn;
let myPlayerType;
let PF;
let lastX, lastY;
let lastPlacedDot = null;

let player1Time = 240; // 4 minutes en secondes
let player2Time = 240;
let commonReflectionTime = 30;
let activeTimer = null;
let reflectionTimer = null;
let isReflectionPhase = true;

// Variable pour suivre si la mise à terre a été utilisée
let miseATerreCooldown = false;


console.log("Initializing game variables");
console.log(`Grid: ${MAX_X}x${MAX_Y}, Canvas: ${WIDTH}x${HEIGHT}, Scale: ${Scale}`);

// Classe Dot pour représenter un point
class Dot {
    constructor(type, x, y) {
        this.x = x;
        this.y = y;
        this.isUnit = false;
        this.captured = false;
        this.status = 0;
        if (type == 1) {
            this.type = "red";
            this.c = "#ed2939";
        } else {
            this.type = "blue";
            this.c = "#4267B2";
        }
    }
    
    neighbors() {
        let n = [];
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                try {
                    if (reddots[this.x + i][this.y + j]) n.push(reddots[this.x + i][this.y + j]);
                    if (bluedots[this.x + i][this.y + j]) n.push(bluedots[this.x + i][this.y + j]);
                } catch (err) {}
            }
        }
        return n;
    }
}

// Fonctions de configuration et rendu
function setup() {
    svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgElement.setAttribute("width", WIDTH);
    svgElement.setAttribute("height", HEIGHT);
    svgElement.style.backgroundColor = "white";
    document.getElementById('gameSVG').appendChild(svgElement);
    
    RED = "#ed2939";
    BLUE = "#4267B2";
    CYAN = "#cccccc";
    LIGHT_RED = '#ffd7d7';
    LIGHT_BLUE = '#d7d7ff';
    
    reddots = matrixArray(MAX_X, MAX_Y);
    bluedots = matrixArray(MAX_X, MAX_Y);
    myPlayerType = localStorage.getItem('playerType');
    
    svgElement.addEventListener('mouseup', mouseReleased);
    svgElement.addEventListener('mousemove', mouseDragged);
}

function draw() {
    svgElement.innerHTML = '';
    field();
    drawShapesAndLines();
    for (let d of render) {
        DotDisplay(d);
    }
}

function DotDisplay(a) {
    const dotGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    
    // Point principal
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", a.x * Scale);
    circle.setAttribute("cy", a.y * Scale);
    circle.setAttribute("r", DOTSIZE / 2);
    circle.setAttribute("fill", a.c);
    dotGroup.appendChild(circle);
    
    // Ajouter un petit point blanc si c'est le dernier point placé
    if (lastPlacedDot && a.x === lastPlacedDot.x && a.y === lastPlacedDot.y) {
        const indicator = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        indicator.setAttribute("cx", a.x * Scale);
        indicator.setAttribute("cy", a.y * Scale);
        indicator.setAttribute("r", DOTSIZE / 6);
        indicator.setAttribute("fill", "white");
        dotGroup.appendChild(indicator);
    }
    
    svgElement.appendChild(dotGroup);
}

function field() {
    const gridGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    
    // Grille verticale
    for (let i = 0; i <= MAX_X; i++) {
        const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        vLine.setAttribute("x1", i * Scale);
        vLine.setAttribute("x2", i * Scale);
        vLine.setAttribute("y1", 0);
        vLine.setAttribute("y2", HEIGHT);
        vLine.setAttribute("stroke", CYAN);
        vLine.setAttribute("stroke-width", "0.5");
        gridGroup.appendChild(vLine);
    }
    
    // Grille horizontale
    for (let i = 0; i <= MAX_Y; i++) {
        const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        hLine.setAttribute("x1", 0);
        hLine.setAttribute("x2", WIDTH);
        hLine.setAttribute("y1", i * Scale);
        hLine.setAttribute("y2", i * Scale);
        hLine.setAttribute("stroke", CYAN);
        hLine.setAttribute("stroke-width", "0.5");
        gridGroup.appendChild(hLine);
    }
    
    svgElement.appendChild(gridGroup);
    
    // Ajouter la zone de départ centrale
    drawStartingZone();
}

function startTimers() {
    // Arrêter les timers existants si nécessaire
    if (activeTimer) clearInterval(activeTimer);
    if (reflectionTimer) clearInterval(reflectionTimer);
    
    isReflectionPhase = true;
    commonReflectionTime = 30; // Réinitialiser le temps de réflexion commun
    
    // Démarrer le timer de réflexion commun
    reflectionTimer = setInterval(() => {
        if (commonReflectionTime > 0) {
            commonReflectionTime--;
            updateTimerDisplay();
            emitTimerUpdate();
        } else {
            // Quand le temps de réflexion est écoulé, passer au temps principal
            isReflectionPhase = false;
            clearInterval(reflectionTimer);
            startMainTimer();
        }
    }, 1000);
}

function startMainTimer() {
    activeTimer = setInterval(() => {
        if (currentTurn === 'player1') {
            if (player1Time > 0) {
                player1Time--;
                updateTimerDisplay();
                emitTimerUpdate();
            } else {
                clearInterval(activeTimer);
                handleTimeOut();
            }
        } else {
            if (player2Time > 0) {
                player2Time--;
                updateTimerDisplay();
                emitTimerUpdate();
            } else {
                clearInterval(activeTimer);
                handleTimeOut();
            }
        }
    }, 1000);
}

function emitTimerUpdate() {
    socket.emit('updateTimers', {
        gameId: localStorage.getItem('gameId'),
        timers: {
            player1Time,
            player2Time,
            commonReflectionTime,
            isReflectionPhase
        }
    });
}


function updateTimerDisplay() {
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Afficher le timer de réflexion commun
    document.getElementById('commonReflectionTimer').innerHTML = 
        isReflectionPhase ? `Temps de réflexion: ${commonReflectionTime}s` : '';

    // Afficher les timers principaux
    document.getElementById('player1MainTimer').textContent = formatTime(player1Time);
    document.getElementById('player2MainTimer').textContent = formatTime(player2Time);

    // Mettre en évidence le joueur actif
    document.querySelector('.player1-avatar').classList.toggle('active', currentTurn === 'player1');
    document.querySelector('.player2-avatar').classList.toggle('active', currentTurn === 'player2');
}

function handleTimeOut() {
    // Gérer la fin du temps pour un joueur
    const loser = currentTurn === 'player1' ? 'player1Name' : 'player2Name';
    const loserName = document.getElementById(loser).textContent;
    alert(`Temps écoulé pour ${loserName} !`);
    // Émettre un événement de fin de partie
    socket.emit('gameOver', {
        gameId: localStorage.getItem('gameId'),
        winner: currentTurn === 'player1' ? 'player2' : 'player1'
    });
}

function drawShapesAndLines() {
    for (let outline of outlines) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let d = "M " + outline.map(p => `${p.x * Scale} ${p.y * Scale}`).join(" L ") + " Z";
        path.setAttribute("d", d);
        path.setAttribute("fill", outline[1].type === "red" ? LIGHT_RED : LIGHT_BLUE);
        path.setAttribute("stroke", outline[1].c);
        path.setAttribute("stroke-width", LINEWEIGHT);
        svgElement.appendChild(path);
    }
}

// Gestion des événements souris
function mouseDragged(event) {
    const rect = svgElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    if (Math.abs(x - lastX) > 10 || Math.abs(y - lastY) > 10) {
        dragging = true;
    }
    
    lastX = x;
    lastY = y;
}

function drawStartingZone() {
    if (render.length >= 2) return; // Ne plus afficher la zone après les deux premiers points
    
    const centerZone = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    centerZone.setAttribute("x", CENTER_ZONE.x * Scale);
    centerZone.setAttribute("y", CENTER_ZONE.y * Scale);
    centerZone.setAttribute("width", CENTER_ZONE.width * Scale);
    centerZone.setAttribute("height", CENTER_ZONE.height * Scale);
    
    // Zone orange/dorée pour indiquer la zone de départ neutre
    centerZone.setAttribute("fill", "#FFD700");
    centerZone.setAttribute("opacity", "0.2");
    centerZone.setAttribute("stroke", "#FFA500");
    centerZone.setAttribute("stroke-width", "1");
    
    svgElement.appendChild(centerZone);
}

// Ajouter ces événements pour la gestion de fin de partie
socket.on('checkCapturesAndEndGame', () => {
    // Vérifier les captures une dernière fois
    for (let i = 0; i < MAX_X; i++) {
        for (let j = 0; j < MAX_Y; j++) {
            if (reddots[i][j]) {
                applyPathfinding(reddots[i][j]);
            }
            if (bluedots[i][j]) {
                applyPathfinding(bluedots[i][j]);
            }
        }
    }
    
    // Mettre à jour le score final
    updateScore();
    
    // Désactiver les interactions avec le jeu
    svgElement.removeEventListener('mouseup', mouseReleased);
    svgElement.removeEventListener('mousemove', mouseDragged);
    
    // Désactiver le bouton mise à terre
    document.getElementById('miseATerreBtn').disabled = true;
    
    // Afficher un message de fin de partie
    const winner = scoreRed > scoreBlue ? 'Rouge' : scoreBlue > scoreRed ? 'Bleu' : 'Égalité';
    const message = `Partie terminée ! \n${winner === 'Égalité' ? 'Match nul' : 'Victoire ' + winner}\nScore final - Rouge: ${scoreRed} | Bleu: ${scoreBlue}`;
    
    setTimeout(() => {
        alert(message);
    }, 500);
});

// Modifier la fonction handleMiseATerre
function handleMiseATerre() {
    if (myPlayerType !== currentTurn) {
        alert("Ce n'est pas votre tour !");
        return;
    }
    
    if (confirm("Êtes-vous sûr de vouloir utiliser la mise à terre ? Cela terminera la partie !")) {
        socket.emit('miseATerre', {
            gameId: localStorage.getItem('gameId')
        });
        // Désactiver immédiatement le bouton
        document.getElementById('miseATerreBtn').disabled = true;
    }
}

// Fonction pour vérifier si un point est dans la zone de départ centrale
function isValidStartingPosition(x, y) {
    // Si ce n'est pas un des deux premiers points, pas besoin de vérifier
    if (render.length >= 2) return true;
    
    // Vérifier si le point est dans la zone centrale
    return x >= CENTER_ZONE.x && 
           x < CENTER_ZONE.x + CENTER_ZONE.width && 
           y >= CENTER_ZONE.y && 
           y < CENTER_ZONE.y + CENTER_ZONE.height;
}

// Modification de la fonction mouseReleased pour inclure la vérification de la zone de départ
function mouseReleased(event) {
    if (dragging) {
        dragging = false;
        return;
    }

    if (myPlayerType !== currentTurn) {
        console.log("Ce n'est pas votre tour");
        return;
    }

    const rect = svgElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    let X = Math.round(x / Scale);
    let Y = Math.round(y / Scale);

    if (X >= MAX_X || Y >= MAX_Y || X < 0 || Y < 0) return;

    if (!isValidStartingPosition(X, Y)) {
        console.log("Position de départ invalide");
        return;
    }

    if (!reddots[X][Y] && !bluedots[X][Y] && capturedEmpty.indexOf(X+' '+Y) === -1) {
        // Arrêter les timers actuels
        if (reflectionTimer) clearInterval(reflectionTimer);
        if (activeTimer) clearInterval(activeTimer);
        
        socket.emit('placeDot', {
            gameId: localStorage.getItem('gameId'),
            x: X,
            y: Y,
            type: myPlayerType
        });
    }
}

// Logique de capture
function applyPathfinding(newdot) {
    let newdotNeighbors = newdot.neighbors();
    let mustSearch = [newdot, ...newdotNeighbors];
    
    for (let dot of mustSearch) {
        if (dot.captured) continue;
        PF = new Pathfinder(dot);
        let path = PF.SearchPath();
        if (path) {
            for (let i = 0; i < path.length; i++) {
                path[i].status = "Chained";
                path[i].outline = outlines.length;
            }
            outlines.push(path);
            // Ne pas mettre à jour updateScore() ici
        }
    }
    // Appeler updateScore une seule fois après toutes les captures
    updateScore();
}

function isAppropriate(path) {
    if (!path || path.length < 3) return false;

    let min = 0, max = 0, Xmin = 0, Xmax = 0;
    let flag = false;
    let xData = {};
    let typedots = (path[0].type != "red") ? reddots : bluedots;
    let reverse_typedots = (path[0].type == "red") ? reddots : bluedots;

    for (let i = 0; i < path.length; i++) {
        if (path[i].y > path[max].y) max = i;
        if (path[i].y < path[min].y) min = i;
        if (path[i].x > path[Xmax].x) Xmax = i;
        if (path[i].x < path[Xmin].x) Xmin = i;
        
        if (!xData[path[i].x]) {
            xData[path[i].x] = [path[i].y];
        } else {
            xData[path[i].x].push(path[i].y);
            xData[path[i].x].sort((a, b) => b - a);
        }
    }

    let temp_captured = [];

    for (let i = path[min].y; i <= path[max].y; i++) {
        let dotsX = path.filter(p => p.y === i).sort((a, b) => a.x - b.x);
        
        for (let j = dotsX[0].x; j <= dotsX[dotsX.length - 1].x; j++) {
            let between_cond = xData[j]?.length > 1 && 
                (xData[j][0] > i && i > xData[j][xData[j].length - 1]);

            if (!between_cond) continue;

            if (!reddots[j][i] && !bluedots[j][i]) {
                temp_captured.push(j + ' ' + i);
            } else if (reverse_typedots[j][i]?.captured) {
                reverse_typedots[j][i].captured = false;
                if (reverse_typedots[j][i].type == "red") scoreBlue--;
                else scoreRed--;
            } else if (typedots[j][i] && !typedots[j][i].captured) {
                typedots[j][i].captured = true;
                if (typedots[j][i].type == "red") scoreBlue++;
                else scoreRed++;
                flag = true;
            }
        }
    }

    if (flag) {
        capturedEmpty.push(...temp_captured);
    }
    return flag;
}

// Classe Pathfinder
class Pathfinder {
    constructor(start) {
        this.start = start;
        this.came_from = matrixArray(MAX_X, MAX_Y);
    }

    neighbors(a) {
        let n = [];
        let otherWays = [];
        let typedots = (a.type == "red") ? reddots : bluedots;
        let positions = [
            [1, -1], [0, -1], [-1, -1], [-1, 0],
            [-1, 1], [0, 1], [1, 1], [1, 0]
        ];

        for (let [dx, dy] of positions) {
            try {
                let current = typedots[a.x + dx][a.y + dy];
                if (current && (!current.captured || current === this.start)) {
                    n.push(current);
                    if (this.came_from[current.x][current.y]) {
                        otherWays.push(current);
                    }
                }
            } catch (err) {}
        }
        return [n, otherWays];
    }

    SearchPath() {
        let frontiers = [this.start];
        this.came_from[this.start.x][this.start.y] = [];

        while (frontiers.length > 0) {
            let current = frontiers.shift();
            let [neighbors, otherWays] = this.neighbors(current);

            if (otherWays.length > 0) {
                for (let dot of otherWays) {
                    if (this.came_from[current.x][current.y].includes(dot)) continue;
                    
                    let path = [...this.came_from[current.x][current.y], current, dot];
                    let secondPart = this.came_from[dot.x][dot.y];
                    
                    if (path[1] === secondPart[1]) continue;
                    
                    path.push(...secondPart.slice(1).reverse());
                    if (isAppropriate(path)) return path;
                }
            }

            for (let next of neighbors) {
                if (!otherWays.includes(next)) {
                    this.came_from[next.x][next.y] = [...this.came_from[current.x][current.y], current];
                    frontiers.push(next);
                }
            }
        }
        return false;
    }
}

// Fonctions utilitaires
function matrixArray(rows, cols) {
    return Array(rows).fill().map(() => Array(cols).fill(undefined));
}

function updateScore() {
    // Préparer l'état complet des points avec leurs états de capture
    const dots = render.map(dot => ({
        x: dot.x,
        y: dot.y,
        type: dot.type === 'red' ? 'player1' : 'player2',
        captured: dot.captured
    }));

    // Préparer les outlines avec le bon format
    const formattedOutlines = outlines.map(outline => 
        outline.map(point => ({
            x: point.x,
            y: point.y,
            type: point.type === 'red' ? 'red' : 'blue',
            c: point.type === 'red' ? '#ed2939' : '#4267B2'
        }))
    );

    socket.emit('updateScore', {
        gameId: localStorage.getItem('gameId'),
        scoreRed,
        scoreBlue,
        dots,
        outlines: formattedOutlines,
        capturedEmpty,
        timers: {
            player1Time,
            player2Time,
            commonReflectionTime,
            isReflectionPhase
        }
    });

    // Mettre à jour l'affichage local
    document.getElementById("RED").innerHTML = scoreRed;
    document.getElementById("BLUE").innerHTML = scoreBlue;
}

// Gestion de l'état du jeu
// Dans game.js - Modifier la fonction handleGameState

// Modifier la fonction handleGameState dans game.js
function handleGameState(gameState) {
    if (!gameState) return;
    
    // Réinitialiser complètement l'état
    render = [];
    reddots = matrixArray(MAX_X, MAX_Y);
    bluedots = matrixArray(MAX_X, MAX_Y);
    outlines = [];  // Important: réinitialiser les outlines
    capturedEmpty = gameState.capturedEmpty || [];
    scoreRed = gameState.scoreRed || 0;
    scoreBlue = gameState.scoreBlue || 0;
    currentTurn = gameState.currentTurn;

    // Restaurer les timers
    if (gameState.timers) {
        player1Time = gameState.timers.player1Time;
        player2Time = gameState.timers.player2Time;
        commonReflectionTime = gameState.timers.commonReflectionTime;
        isReflectionPhase = gameState.timers.isReflectionPhase;
    }

    // Restaurer les points sans recalculer les captures
    if (gameState.dots?.length > 0) {
        for (const dot of gameState.dots) {
            let newDot = new Dot(dot.type === 'player1' ? 1 : 2, dot.x, dot.y);
            if (dot.captured) newDot.captured = true;
            
            if (dot.type === 'player1') {
                reddots[dot.x][dot.y] = newDot;
            } else {
                bluedots[dot.x][dot.y] = newDot;
            }
            render.push(newDot);
        }
    }

    // Restaurer les outlines depuis gameState
    if (gameState.outlines && Array.isArray(gameState.outlines)) {
        outlines = gameState.outlines.map(outline => 
            outline.map(point => {
                const dotType = point.type === 'red' ? 1 : 2;
                const newDot = new Dot(dotType, point.x, point.y);
                newDot.c = point.c;
                return newDot;
            })
        );
    }

    // Mettre à jour l'affichage
    updateTimerDisplay();
    document.getElementById("RED").innerHTML = scoreRed;
    document.getElementById("BLUE").innerHTML = scoreBlue;
    draw();
}

// Événements socket
// Événements socket
socket.on('gameJoined', (data) => {
    myPlayerType = data.playerType;
    currentTurn = data.gameState.currentTurn;
    
    // Mettre à jour les noms des joueurs
    if (data.gameState.player1Name) {
        document.getElementById('player1Name').textContent = data.gameState.player1Name;
    }
    if (data.gameState.player2Name) {
        document.getElementById('player2Name').textContent = data.gameState.player2Name;
    }
    
    handleGameState(data.gameState);
    
    if (render.length === 0) {
        //initializeCenterPoints();
    }
});
socket.on('gameStart', (gameState) => {
    if (gameState.player1Name) {
        document.getElementById('player1Name').textContent = gameState.player1Name;
    }
    if (gameState.player2Name) {
        document.getElementById('player2Name').textContent = gameState.player2Name;
    }
    startTimers();
});

socket.on('dotPlaced', (data) => {
    let newDot = new Dot(data.type === 'player1' ? 1 : 2, data.x, data.y);
    if (data.type === 'player1') {
        reddots[data.x][data.y] = newDot;
    } else {
        bluedots[data.x][data.y] = newDot;
    }
    render.push(newDot);
    lastPlacedDot = newDot; // Mettre à jour le dernier point placé
    applyPathfinding(newDot);
});

socket.on('turnChange', (newTurn) => {
    currentTurn = newTurn;
    startTimers(); // Réinitialiser le temps de réflexion à chaque changement de tour
    updateTimerDisplay();
});

socket.on('scoreUpdated', (gameState) => {
    scoreRed = gameState.scoreRed;
    scoreBlue = gameState.scoreBlue;
    
    // Important : ne pas appeler handleGameState ici pour éviter la récursion
    document.getElementById("RED").innerHTML = scoreRed;
    document.getElementById("BLUE").innerHTML = scoreBlue;
    
    // Mettre à jour l'état du jeu sans recalculer les captures
    if (gameState.outlines) {
        outlines = gameState.outlines.map(outline => 
            outline.map(point => {
                const dotType = point.type === 'red' ? 1 : 2;
                const newDot = new Dot(dotType, point.x, point.y);
                newDot.c = point.c;
                return newDot;
            })
        );
    }
    
    // Redessiner le jeu
    draw();
});
socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    
    // Si on a un gameId stocké, tenter de rejoindre automatiquement
    const storedGameId = localStorage.getItem('gameId');
    if (storedGameId) {
        socket.emit('joinGame', storedGameId);
    }
});

socket.on('disconnect', () => {
    console.log('Socket disconnected - attempting reconnection...');
});

socket.io.on('reconnect', () => {
    console.log('Socket reconnected:', socket.id);
    const storedGameId = localStorage.getItem('gameId');
    if (storedGameId) {
        socket.emit('joinGame', storedGameId);
    }
});

// Dans game.html, ajouter la gestion de la visibilité
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (socket.disconnected) {
            socket.connect();
        }
    }
});


// Boucle de jeu principale
function gameLoop() {
    draw();
    requestAnimationFrame(gameLoop);
}

// Démarrage du jeu
document.addEventListener('DOMContentLoaded', () => {
    setup();
    gameLoop();
});

// Gestion du redimensionnement
window.addEventListener('resize', () => {
    Scale = Math.min((window.innerWidth - 100) / MAX_X, (window.innerHeight - 300) / MAX_Y);
    WIDTH = Scale * (MAX_X - 1);
    HEIGHT = Scale * (MAX_Y - 1);
    DOTSIZE = Scale / 1.8;
    LINEWEIGHT = DOTSIZE / 8;
    
    svgElement.setAttribute("width", WIDTH);
    svgElement.setAttribute("height", HEIGHT);
});