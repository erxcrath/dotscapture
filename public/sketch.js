const socket = io();
let gameId;
let playerType;
let currentTurn;

console.log("Initializing game variables");

// Fonction pour initialiser les points au centre
function initializeCenterPoints() {
  const centerX = Math.floor(MAX_X / 2);
  const centerY = Math.floor(MAX_Y / 2);

  // Créer les points
  const redDot1 = new Dot(1, centerX - 1, centerY - 1);
  const redDot2 = new Dot(1, centerX + 0, centerY + 0);
  const blueDot1 = new Dot(2, centerX - 1, centerY + 0);
  const blueDot2 = new Dot(2, centerX + 0, centerY - 1);

  // Ajouter les points aux tableaux correspondants
  reddots[centerX - 1][centerY - 1] = redDot1;
  reddots[centerX + 0][centerY + 0] = redDot2;
  bluedots[centerX - 1][centerY + 0] = blueDot1;
  bluedots[centerX + 0][centerY - 1] = blueDot2;

  // Ajouter les points au tableau render
  render.push(redDot1, redDot2, blueDot1, blueDot2);

  console.log("Initialized center points");
}

function matrixArray(rows, columns) {
  var arr = new Array();
  for (var i = 0; i < rows; i++) {
    arr[i] = new Array();
    for (var j = 0; j < columns; j++) {
      arr[i][j] = undefined
    }
  }
  console.log(`Created matrix array: ${rows}x${columns}`);
  return arr;
}

// Nouvelles dimensions de la grille
const MAX_X = 39;
const MAX_Y = 32;
console.log(`Grid dimensions set to ${MAX_X}x${MAX_Y}`);

// Ajustement de la taille et de l'échelle
var Scale = Math.min(screen.width / MAX_X, screen.height / MAX_Y);
var WIDTH = Scale * (MAX_X - 1);
var HEIGHT = Scale * MAX_Y;

console.log(`Canvas size set to ${WIDTH}x${HEIGHT}, Scale: ${Scale}`);

const DOTSIZE = Scale / 2.8;
const LINEWEIGHT = DOTSIZE / 6;

console.log(`DOTSIZE: ${DOTSIZE}, LINEWEIGHT: ${LINEWEIGHT}`);

var PF;
var counter;
var render = [];
var outlines = [];
var shapes = [];
var reddots = [];
var scoreRed = 0;
var scoreBlue = 0;
var bluedots = [];
var dragging = false;
var capturedEmpty = [];

function joinGame() {
  gameId = document.getElementById('gameId').value;
  socket.emit('joinGame', gameId);
  console.log(`Attempting to join game: ${gameId}`);
}

socket.on('gameJoined', (data) => {
  playerType = data.playerType;
  gameState = data.gameState;
  render = gameState.dots;
  scoreRed = gameState.scoreRed;
  scoreBlue = gameState.scoreBlue;
  currentTurn = gameState.currentTurn;

  console.log(`Joined game as ${playerType}`);
  console.log(`Initial game state:`, gameState);

  // Si le tableau de points est vide, initialiser les points centraux
  if (render.length === 0) {
    initializeCenterPoints();
    // Mettre à jour l'état du jeu sur le serveur
    socket.emit('updateGameState', { gameId, dots: render });
  } else {
    // Sinon, initialiser les tableaux reddots et bluedots avec les points existants
    for (let dot of render) {
      if (dot.type === 'red') {
        reddots[dot.x][dot.y] = new Dot(1, dot.x, dot.y);
      } else {
        bluedots[dot.x][dot.y] = new Dot(2, dot.x, dot.y);
      }
    }
  }
});

socket.on('gameStart', (initialGameState) => {
  console.log('Game started', initialGameState);
});

socket.on('gameFull', () => {
  console.log('Game is full');
});

socket.on('dotPlaced', (data) => {
  console.log('Dot placed:', data);
  let newDot;
  if (data.type === 'player1') {
    newDot = new Dot(1, data.x, data.y);
    reddots[data.x][data.y] = newDot;
  } else {
    newDot = new Dot(2, data.x, data.y);
    bluedots[data.x][data.y] = newDot;
  }
  render.push(newDot);
  
  applyPathfinding(newDot);
});

socket.on('turnChange', (newTurn) => {
  currentTurn = newTurn;
  console.log('Turn changed to:', newTurn);
});

socket.on('scoreUpdated', (data) => {
  scoreRed = data.scoreRed;
  scoreBlue = data.scoreBlue;
  updateScoreDisplay();
  console.log('Score updated:', data);
});

function setup() {
  createCanvas(WIDTH, HEIGHT);
  console.log(`Canvas created: ${WIDTH}x${HEIGHT}`);
  if (screen.width > 480) {
    select('canvas').style('display','block');
    select('canvas').style('margin','0 auto');
  } else {
    select('canvas').style('width', '100%', '!important');
    select('canvas').style('height', '100%', '!important')
  }
  RED = color(255, 0, 0);
  BLUE = color(0, 0, 255);
  CYAN = color(0, 191, 255);
  LIGHT_RED = color('#ffd7d7');
  LIGHT_BLUE = color('#d7d7ff');

  reddots = matrixArray(MAX_X, MAX_Y);
  bluedots = matrixArray(MAX_X, MAX_Y);
  counter = 0;
  console.log('Setup completed');
}

function draw() {
  background(255);
  myRender();
  for (var d in render) {
    DotDisplay(render[d]);
  }
}

class Dot {
  constructor(type, x, y) {
    this.x = x;
    this.y = y;
    this.isUnit = false;
    this.captured = false;
    this.status = 0;
    if (type == 1) {
      this.type = "red";
      this.c = RED;
    } else {
      this.type = "blue";
      this.c = BLUE;
    }
    console.log(`New dot created: ${this.type} at (${x}, ${y})`);
  }
  neighbors() {
    var n = [];
    for (var i = -1; i <= 1; i++) {
      for (var j = -1; j <= 1; j++) {
        try {
          if (reddots[this.x + i][this.y + j] != undefined) n.push(reddots[this.x + i][this.y + j]);
          if (bluedots[this.x + i][this.y + j] != undefined) n.push(bluedots[this.x + i][this.y + j]);
        } catch (err) {
          console.log('Missed border dot');
        }
      }
    }
    return n;
  }
}

function DotDisplay(a) {
  stroke(a.c);
  fill(a.c);
  if (a.captured) strokeWeight(LINEWEIGHT*0.01)
    else strokeWeight(LINEWEIGHT);
  ellipse(a.x * Scale, a.y * Scale, DOTSIZE, DOTSIZE);
}

function mouseDragged() {
  if (abs(pmouseX - mouseX) > 10 || abs(pmouseY - mouseY) > 10) {
    dragging = true;
    console.log('Dragging detected');
  }
}

function mouseReleased() {
  if (dragging) {
    dragging = false;
    console.log('Drag ended');
    return;
  }
  
  if (currentTurn !== playerType) {
    console.log("Not your turn");
    return;
  }

  var X = round(mouseX / Scale);
  var Y = round(mouseY / Scale);

  console.log(`Mouse released at grid position: (${X}, ${Y})`);

  if (X >= MAX_X || Y >= MAX_Y || X < 0 || Y < 0) {
    console.log('Click outside of valid grid area');
    return;
  }
  if (reddots[X][Y] == undefined && bluedots[X][Y] == undefined && capturedEmpty.indexOf(X+' '+Y) == -1) {
    var type = (playerType === 'player1') ? 1 : 2;
    
    socket.emit('placeDot', { gameId, x: X, y: Y, type: playerType });
    console.log(`Emitting placeDot event: ${X}, ${Y}, ${playerType}`);
  }
}

function applyPathfinding(newdot) {
  console.log(`Applying pathfinding for new dot at (${newdot.x}, ${newdot.y})`);
  var newdotNeighbors = newdot.neighbors();
  var mustSearch = [newdot, ...newdotNeighbors];

  for (var dot of mustSearch) {
    if (dot.captured) continue;
    PF = new Pathfinder(dot);
    path = PF.SearchPath();
    if (path) {
      console.log(`Path found for dot at (${dot.x}, ${dot.y})`);
      for (var i = 0; i < path.length; i++) {
        path[i].status = "Chained";
        path[i].outline = outlines.length;
      }
      outlines.push(path);
    }
  }

  updateScore();
}

function updateScore() {
  console.log(`Updating score: Red ${scoreRed}, Blue ${scoreBlue}`);
  socket.emit('updateScore', { gameId, scoreRed, scoreBlue });
  document.getElementById("RED").innerHTML = scoreRed;
  document.getElementById("BLUE").innerHTML = scoreBlue;
}

function field() {
  console.log('Drawing field');
  stroke(CYAN);
  strokeWeight(1);
  for (var i = 0; i <= WIDTH; i += Scale) {
    line(i, 0, i, HEIGHT);
  }
  for (var i = 0; i <= HEIGHT; i += Scale) {
    line(0, i, WIDTH, i);
  }
}

function myRender() {
  console.log('Rendering game state');
  for (var i = 0; i < outlines.length; i++) {
    generateShape(outlines[i]);
  }
  field();
  strokeWeight(LINEWEIGHT);
  for (var i = 0; i < outlines.length; i++) {
    var col = outlines[i][1].c;
    stroke(col);
    for (var j = 0; j < outlines[i].length; j++) {
      var current = outlines[i][j];
      if (j != outlines[i].length - 1) {
        var next = outlines[i][j + 1];
        line(current.x * Scale, current.y * Scale, next.x * Scale, next.y * Scale);
      } else {
        var first = outlines[i][0];
        line(current.x * Scale, current.y * Scale, first.x * Scale, first.y * Scale);
      }
    }
  }
}

function generateShape(path) {
  console.log('Generating shape');
  beginShape();
  fillcolor = (path[1].type == "red") ? LIGHT_RED : LIGHT_BLUE;
  fill(fillcolor);
  noStroke();
  for (var i = 0; i < path.length; i++) {
    vertex(path[i].x * Scale, path[i].y * Scale);
  }
  endShape(CLOSE);
}

function isAppropriate(path) {
  console.log('Checking if path is appropriate');
  // ... (rest of the function remains the same)
}

function Pathfinder(start) {
  console.log(`Initializing Pathfinder for dot at (${start.x}, ${start.y})`);
  // ... (rest of the function remains the same)
}

console.log('Game code initialized');  
  function isAppropriate(path) {
    let min = 0;
    let max = 0;
    let Xmin = 0;
    let Xmax = 0;
    let flag = false;
    var xData = {};
    let typedots = (path[0].type != "red") ? reddots : bluedots;
    let reverse_typedots = (path[0].type == "red") ? reddots : bluedots;
    for (dot in path) {
  
      if (xData[path[dot].x] == undefined) {
        xData[path[dot].x] = [];
        xData[path[dot].x].push(path[dot].y);
      } else {
        xData[path[dot].x].push(path[dot].y);
        xData[path[dot].x].sort(function(a, b) {
          return b - a
        });
      }
      if (path[dot].y > path[max].y) max = dot;
      if (path[dot].y < path[min].y) min = dot;
      if (path[dot].x > path[Xmax].x) Xmax = dot;
      if (path[dot].x < path[Xmin].x) Xmin = dot;
    }
  
    var temp_captured = [];
  
    for (var i = path[min].y; i <= path[max].y; i++) {
      let dotsX = [];
      for (var j = 0; j < path.length; j++) {
        if (path[j].y == i) dotsX.push(path[j]);
      }
      dotsX.sort((a, b) => {
        return a.x - b.x
      })
      for (var j = dotsX[0].x; j <= dotsX[dotsX.length - 1].x; j++) {
        // // console.log('X: '+ j + 'Y: ' + i + typedots[j][i]);
        var between_cond = false;
        if (xData[j].length > 1) { // чтобы нормально определял окружённые точки
          between_cond = (xData[j][0] > i && i > xData[j][xData[j].length - 1]);
        }
  
        if (reddots[j][i] == undefined && bluedots[j][i] == undefined && between_cond)
          temp_captured.push(j + ' ' + i)
  
        if (reverse_typedots[j][i] != undefined && reverse_typedots[j][i].captured && between_cond) { // нахождение своих точек и обнуление вражеского счёта
          if (reverse_typedots[j][i].type == "red") scoreBlue--
            else scoreRed--;
          reverse_typedots[j][i].captured = false;
        }
        if (typedots[j][i] != undefined && !typedots[j][i].captured && between_cond) { // нахождение вражеских точек и увеличение счёта
          typedots[j][i].captured = true;
          if (typedots[j][i].type == "red") scoreBlue++
            else scoreRed++;
          flag = true;
        }
      }
    }
    // // console.log('Max x ' + path[Xmax].x + ' Min x ' + path[Xmin].x + ' Max y' + path[max].y + 'Min y' + path[min].y);
    // // console.log(debug);
    // console.log(xData);
    if (flag) {
      Array.prototype.push.apply(capturedEmpty,temp_captured);
    }
    return flag;
  }
  
  function Pathfinder(start) {
  
    this.start = start;
    this.came_from = matrixArray(MAX_X, MAX_Y);
  
    this.neighbors = function(a) {
      var n = [];
      var otherWays = [];
      var typedots = (a.type == "red") ? reddots : bluedots;
      var clock = [
        [1, -1],
        [0, -1],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
        [1, 0]
      ]; // [8][2]
      for (var i = 0; i <= 7; i++) {
        try {
          var current = typedots[a.x + clock[i][0]][a.y + clock[i][1]];
          if (current != undefined && !current.captured || current == this.start) { // self skipping and checked skipping || adding start
            n.push(current);
            if (this.came_from[current.x][current.y] != undefined) {
              otherWays.push(current);
            }
          }
        } catch (err) {
          // console.log("Missed border dot");
        }
      }
      return [n, otherWays];
    };
  
    this.SearchPath = function() {
      var frontiers = [];
      frontiers.push(this.start);
      this.came_from[this.start.x][this.start.y] = [];
  
      while (frontiers.length > 0) {
        var current = frontiers.shift();
        // console.log('');
        // console.log('DOT ' + current.x + ' ' + current.y);
        // for (var j in this.came_from[current.x][current.y])
        //   // console.log(`Came from: (${this.came_from[current.x][current.y][j].x},${this.came_from[current.x][current.y][j].y})`);
        var neighbors = this.neighbors(current);
        if (neighbors.length == 2) {
          var otherWays = neighbors[1];
          // // console.log('Otherways: ');
        }
        neighbors = neighbors[0];
  
        //Found a way
        if (otherWays.length > 0) {
          for (var i = 0; i < otherWays.length; i++) {
            var dot = otherWays[i];
            if (this.came_from[current.x][current.y].indexOf(dot) != -1)
              continue;
            var path = this.came_from[current.x][current.y].slice(0);
            //creating a path:
            path.push(current);
            path.push(dot);
            var secondPart = this.came_from[dot.x][dot.y].slice(0);
            if (path[1] == secondPart[1])
              continue;
            secondPart.splice(0, 1);
            Array.prototype.push.apply(path, secondPart.reverse());
  
            if (isAppropriate(path)) {
              // // console.log('May found a way between (' + current.x + ',' + current.y + ') and (' + dot.x + ',' + dot.y + ')');
              // for (var j in path) // console.log(`Path ${j} : (${path[j].x},${path[j].y})`);
              return path;
            }
          }
        }
  
        for (i in neighbors) {
          var next = neighbors[i];
          if (otherWays.indexOf(next) == -1) {
            this.came_from[next.x][next.y] = [];
            Array.prototype.push.apply(this.came_from[next.x][next.y], this.came_from[current.x][current.y]);
            this.came_from[next.x][next.y].push(current);
            frontiers.push(next);
          }
        }
  
      }
      return false;
    }
  };
  