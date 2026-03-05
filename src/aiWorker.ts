/// <reference lib="webworker" />

type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
type Color = "w" | "b";

interface Piece {
  type: PieceType;
  color: Color;
}

type Square = Piece | null;

interface Move {
  from: [number, number];
  to: [number, number];
  promotion?: PieceType;
  isEnPassant?: boolean;
  castling?: "short" | "long";
}

interface Board {
  squares: Square[][];
  turn: Color;
  castling: string;
  enPassant: { row: number; col: number } | null;
  halfMove: number;
  fullMove: number;
  gameOver: boolean;
  winner: Color | "draw" | null;
}

interface WorkerSearchRequest {
  type: "search";
  id: number;
  board: Board;
  depth: number;
  repetitionHistory: string[];
}

interface WorkerSearchResult {
  type: "result";
  id: number;
  turn: Color;
  move: Move | null;
}

const pieceValues: Record<PieceType, number> = {
  p: 100,
  n: 330,
  b: 330,
  r: 520,
  q: 900,
  k: 20000,
};

const pieceOrder: PieceType[] = ["p", "n", "b", "r", "q", "k"];
const pieceIndex: Record<PieceType, number> = {
  p: 0,
  n: 1,
  b: 2,
  r: 3,
  q: 4,
  k: 5,
};

const pawnTable = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [5, 5, 10, 25, 25, 10, 5, 5],
  [0, 0, 0, 20, 20, 0, 0, 0],
  [5, -5, -10, 0, 0, -10, -5, 5],
  [5, 10, 10, -20, -20, 10, 10, 5],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const knightTable = [
  [-50, -40, -30, -30, -30, -30, -40, -50],
  [-40, -20, 0, 0, 0, 0, -20, -40],
  [-30, 0, 10, 15, 15, 10, 0, -30],
  [-30, 5, 15, 20, 20, 15, 5, -30],
  [-30, 0, 15, 20, 20, 15, 0, -30],
  [-30, 5, 10, 15, 15, 10, 5, -30],
  [-40, -20, 0, 5, 5, 0, -20, -40],
  [-50, -40, -30, -30, -30, -30, -40, -50],
];

const bishopTable = [
  [-20, -10, -10, -10, -10, -10, -10, -20],
  [-10, 0, 0, 0, 0, 0, 0, -10],
  [-10, 0, 5, 10, 10, 5, 0, -10],
  [-10, 5, 5, 10, 10, 5, 5, -10],
  [-10, 0, 10, 10, 10, 10, 0, -10],
  [-10, 10, 10, 10, 10, 10, 10, -10],
  [-10, 5, 0, 0, 0, 0, 5, -10],
  [-20, -10, -10, -10, -10, -10, -10, -20],
];

const rookTable = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 10, 10, 10, 10, 10, 10, 5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [-5, 0, 0, 0, 0, 0, 0, -5],
  [0, 0, 0, 5, 5, 0, 0, 0],
];

const kingTableMid = [
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-30, -40, -40, -50, -50, -40, -40, -30],
  [-20, -30, -30, -40, -40, -30, -30, -20],
  [-10, -20, -20, -20, -20, -20, -20, -10],
  [20, 20, 0, 0, 0, 0, 20, 20],
  [20, 30, 10, 0, 0, 10, 30, 20],
];

const kingTableEnd = [
  [-50, -40, -30, -20, -20, -30, -40, -50],
  [-30, -20, -10, 0, 0, -10, -20, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 30, 40, 40, 30, -10, -30],
  [-30, -10, 20, 30, 30, 20, -10, -30],
  [-30, -30, 0, 0, 0, 0, -30, -30],
  [-50, -30, -30, -30, -30, -30, -30, -50],
];

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUint32(rng: () => number): number {
  return Math.floor(rng() * 0x100000000) >>> 0;
}

function randomBigInt(rng: () => number): bigint {
  const high = randomUint32(rng);
  const low = randomUint32(rng);
  return (BigInt(high) << 32n) | BigInt(low);
}

function createZobrist() {
  const rng = mulberry32(0xc0ffee);
  const pieceKeys = Array.from({ length: 2 }, () =>
    Array.from({ length: pieceOrder.length }, () =>
      Array.from({ length: 64 }, () => randomBigInt(rng)),
    ),
  );
  const castlingKeys = Array.from({ length: 4 }, () => randomBigInt(rng));
  const enPassantKeys = Array.from({ length: 64 }, () => randomBigInt(rng));
  const turnKey = randomBigInt(rng);
  return { pieceKeys, castlingKeys, enPassantKeys, turnKey };
}

const zobrist = createZobrist();

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

function cyclicCol(col: number, delta: number): number {
  return mod(col + delta, 8);
}

function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function hashBoard(board: Board): string {
  let hash = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (!piece) continue;
      const colorIndex = piece.color === "w" ? 0 : 1;
      const pieceIdx = pieceIndex[piece.type];
      const square = row * 8 + col;
      hash ^= zobrist.pieceKeys[colorIndex][pieceIdx][square];
    }
  }
  if (board.turn === "b") {
    hash ^= zobrist.turnKey;
  }
  if (board.castling.includes("K")) hash ^= zobrist.castlingKeys[0];
  if (board.castling.includes("Q")) hash ^= zobrist.castlingKeys[1];
  if (board.castling.includes("k")) hash ^= zobrist.castlingKeys[2];
  if (board.castling.includes("q")) hash ^= zobrist.castlingKeys[3];
  if (board.enPassant) {
    const square = board.enPassant.row * 8 + board.enPassant.col;
    hash ^= zobrist.enPassantKeys[square];
  }
  return hash.toString(16);
}

function buildRepetitionCounts(history: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of history) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function cloneBoard(board: Board): Board {
  return {
    squares: board.squares.map((row) =>
      row.map((square) => (square ? { ...square } : null)),
    ),
    turn: board.turn,
    castling: board.castling,
    enPassant: board.enPassant ? { ...board.enPassant } : null,
    halfMove: board.halfMove,
    fullMove: board.fullMove,
    gameOver: board.gameOver,
    winner: board.winner,
  };
}

function isInBounds(row: number): boolean {
  return row >= 0 && row < 8;
}

function findKing(board: Board, color: Color): { row: number; col: number } | null {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (piece && piece.color === color && piece.type === "k") {
        return { row, col };
      }
    }
  }
  return null;
}

function isSquareAttacked(board: Board, row: number, col: number, defending: Color): boolean {
  const attacker = opposite(defending);

  const pawnDir = attacker === "w" ? 1 : -1;
  const pawnRow = row - pawnDir;
  if (isInBounds(pawnRow)) {
    const leftCol = cyclicCol(col, -1);
    const rightCol = cyclicCol(col, 1);
    const left = board.squares[pawnRow][leftCol];
    const right = board.squares[pawnRow][rightCol];
    if (left && left.color === attacker && left.type === "p") return true;
    if (right && right.color === attacker && right.type === "p") return true;
  }

  const knightOffsets = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  for (const [dr, dc] of knightOffsets) {
    const r = row + dr;
    const c = cyclicCol(col, dc);
    if (!isInBounds(r)) continue;
    const piece = board.squares[r][c];
    if (piece && piece.color === attacker && piece.type === "n") return true;
  }

  const kingOffsets = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];
  for (const [dr, dc] of kingOffsets) {
    const r = row + dr;
    const c = cyclicCol(col, dc);
    if (!isInBounds(r)) continue;
    const piece = board.squares[r][c];
    if (piece && piece.color === attacker && piece.type === "k") return true;
  }

  const rookDirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dr, dc] of rookDirs) {
    let r = row + dr;
    let c = cyclicCol(col, dc);
    let steps = 0;
    while (isInBounds(r) && steps < 8) {
      if (r === row && c === col) break;
      const piece = board.squares[r][c];
      if (piece) {
        if (piece.color === attacker && (piece.type === "r" || piece.type === "q")) {
          return true;
        }
        break;
      }
      r += dr;
      c = cyclicCol(c, dc);
      steps += 1;
    }
  }

  const bishopDirs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dr, dc] of bishopDirs) {
    let r = row + dr;
    let c = cyclicCol(col, dc);
    let steps = 0;
    while (isInBounds(r) && steps < 8) {
      if (r === row && c === col) break;
      const piece = board.squares[r][c];
      if (piece) {
        if (piece.color === attacker && (piece.type === "b" || piece.type === "q")) {
          return true;
        }
        break;
      }
      r += dr;
      c = cyclicCol(c, dc);
      steps += 1;
    }
  }

  return false;
}

function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king.row, king.col, color);
}

function generateSlidingMoves(
  board: Board,
  row: number,
  col: number,
  color: Color,
  directions: number[][],
): Move[] {
  const moves: Move[] = [];
  for (const [dr, dc] of directions) {
    let r = row + dr;
    let c = cyclicCol(col, dc);
    let steps = 0;
    while (isInBounds(r) && steps < 8) {
      if (r === row && c === col) break;
      const target = board.squares[r][c];
      if (!target) {
        moves.push({ from: [row, col], to: [r, c] });
      } else {
        if (target.color !== color) {
          moves.push({ from: [row, col], to: [r, c] });
        }
        break;
      }
      r += dr;
      c = cyclicCol(c, dc);
      steps += 1;
    }
  }
  return moves;
}

function generateKnightMoves(board: Board, row: number, col: number, color: Color): Move[] {
  const moves: Move[] = [];
  const offsets = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  for (const [dr, dc] of offsets) {
    const r = row + dr;
    const c = cyclicCol(col, dc);
    if (!isInBounds(r)) continue;
    const target = board.squares[r][c];
    if (!target || target.color !== color) {
      moves.push({ from: [row, col], to: [r, c] });
    }
  }
  return moves;
}

function generatePawnMoves(board: Board, row: number, col: number, color: Color): Move[] {
  const moves: Move[] = [];
  const direction = color === "w" ? 1 : -1;
  const startRow = color === "w" ? 1 : 6;
  const promotionRow = color === "w" ? 7 : 0;

  const forwardRow = row + direction;
  if (isInBounds(forwardRow) && board.squares[forwardRow][col] === null) {
    if (forwardRow === promotionRow) {
      for (const promo of ["q", "r", "b", "n"] as PieceType[]) {
        moves.push({ from: [row, col], to: [forwardRow, col], promotion: promo });
      }
    } else {
      moves.push({ from: [row, col], to: [forwardRow, col] });
    }

    const doubleRow = row + direction * 2;
    if (row === startRow && isInBounds(doubleRow) && board.squares[doubleRow][col] === null) {
      moves.push({ from: [row, col], to: [doubleRow, col] });
    }
  }

  for (const dc of [-1, 1]) {
    const captureCol = cyclicCol(col, dc);
    if (!isInBounds(forwardRow)) continue;
    const target = board.squares[forwardRow][captureCol];
    if (target && target.color !== color) {
      if (forwardRow === promotionRow) {
        for (const promo of ["q", "r", "b", "n"] as PieceType[]) {
          moves.push({
            from: [row, col],
            to: [forwardRow, captureCol],
            promotion: promo,
          });
        }
      } else {
        moves.push({ from: [row, col], to: [forwardRow, captureCol] });
      }
    }
  }

  if (board.enPassant) {
    const targetRow = row + direction;
    if (targetRow === board.enPassant.row) {
      const leftCol = cyclicCol(col, -1);
      const rightCol = cyclicCol(col, 1);
      const epCol = board.enPassant.col;
      const adjacentPawn = board.squares[row][epCol];
      if (adjacentPawn && adjacentPawn.color !== color && adjacentPawn.type === "p") {
        if (leftCol === epCol) {
          moves.push({
            from: [row, col],
            to: [targetRow, leftCol],
            isEnPassant: true,
          });
        }
        if (rightCol === epCol) {
          moves.push({
            from: [row, col],
            to: [targetRow, rightCol],
            isEnPassant: true,
          });
        }
      }
    }
  }

  return moves;
}

function generateCastlingMoves(board: Board, row: number, col: number, color: Color): Move[] {
  if (row !== (color === "w" ? 0 : 7) || col !== 4) return [];
  if (isInCheck(board, color)) return [];
  const moves: Move[] = [];
  const rights = board.castling;

  const shortRight = color === "w" ? "K" : "k";
  if (rights.includes(shortRight)) {
    const rookCol = 7;
    const rook = board.squares[row][rookCol];
    if (rook && rook.color === color && rook.type === "r") {
      let clear = true;
      let c = cyclicCol(col, 1);
      let steps = 0;
      while (c !== rookCol && steps < 8) {
        if (board.squares[row][c] !== null) {
          clear = false;
          break;
        }
        c = cyclicCol(c, 1);
        steps += 1;
      }
      if (clear) {
        const pass = cyclicCol(col, 1);
        const target = cyclicCol(col, 2);
        if (!isSquareAttacked(board, row, pass, color) && !isSquareAttacked(board, row, target, color)) {
          moves.push({ from: [row, col], to: [row, target], castling: "short" });
        }
      }
    }
  }

  const longRight = color === "w" ? "Q" : "q";
  if (rights.includes(longRight)) {
    const rookCol = 0;
    const rook = board.squares[row][rookCol];
    if (rook && rook.color === color && rook.type === "r") {
      let clear = true;
      let c = cyclicCol(col, -1);
      let steps = 0;
      while (c !== rookCol && steps < 8) {
        if (board.squares[row][c] !== null) {
          clear = false;
          break;
        }
        c = cyclicCol(c, -1);
        steps += 1;
      }
      if (clear) {
        const pass = cyclicCol(col, -1);
        const target = cyclicCol(col, -2);
        if (!isSquareAttacked(board, row, pass, color) && !isSquareAttacked(board, row, target, color)) {
          moves.push({ from: [row, col], to: [row, target], castling: "long" });
        }
      }
    }
  }

  return moves;
}

function generateKingMoves(board: Board, row: number, col: number, color: Color): Move[] {
  const moves: Move[] = [];
  const offsets = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];
  for (const [dr, dc] of offsets) {
    const r = row + dr;
    const c = cyclicCol(col, dc);
    if (!isInBounds(r)) continue;
    const target = board.squares[r][c];
    if (!target || target.color !== color) {
      moves.push({ from: [row, col], to: [r, c] });
    }
  }
  moves.push(...generateCastlingMoves(board, row, col, color));
  return moves;
}

function generatePseudoMovesForPiece(board: Board, row: number, col: number, piece: Piece): Move[] {
  switch (piece.type) {
    case "p":
      return generatePawnMoves(board, row, col, piece.color);
    case "n":
      return generateKnightMoves(board, row, col, piece.color);
    case "b":
      return generateSlidingMoves(board, row, col, piece.color, [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]);
    case "r":
      return generateSlidingMoves(board, row, col, piece.color, [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]);
    case "q":
      return generateSlidingMoves(board, row, col, piece.color, [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]);
    case "k":
      return generateKingMoves(board, row, col, piece.color);
    default:
      return [];
  }
}

function isMoveLegal(board: Board, move: Move, movingColor: Color): boolean {
  const testBoard = cloneBoard(board);
  testBoard.turn = movingColor;
  applyMove(testBoard, move);
  return !isInCheck(testBoard, movingColor);
}

function generateAllLegalMoves(board: Board, color: Color): Move[] {
  const moves: Move[] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (!piece || piece.color !== color) continue;
      const pseudoMoves = generatePseudoMovesForPiece(board, row, col, piece);
      for (const move of pseudoMoves) {
        if (isMoveLegal(board, move, color)) {
          moves.push(move);
        }
      }
    }
  }
  return moves;
}

function applyMove(board: Board, move: Move): void {
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const piece = board.squares[fromRow][fromCol];
  if (!piece) return;

  const movingColor = piece.color;
  const target = board.squares[toRow][toCol];

  const isPawnMove = piece.type === "p";
  const isCapture = !!target || move.isEnPassant;
  board.halfMove = isPawnMove || isCapture ? 0 : board.halfMove + 1;

  if (move.isEnPassant) {
    board.squares[fromRow][toCol] = null;
  }

  board.squares[fromRow][fromCol] = null;

  if (move.castling) {
    const direction = move.castling === "short" ? 1 : -1;
    const rookCol = move.castling === "short" ? 7 : 0;
    const rookTargetCol = cyclicCol(fromCol, direction);
    const rook = board.squares[fromRow][rookCol];
    board.squares[fromRow][rookCol] = null;
    if (rook) {
      board.squares[fromRow][rookTargetCol] = rook;
    }
  }

  let placedPiece = piece;
  if (move.promotion && piece.type === "p") {
    placedPiece = { type: move.promotion, color: piece.color };
  } else if (piece.type === "p") {
    const promotionRow = piece.color === "w" ? 7 : 0;
    if (toRow === promotionRow) {
      placedPiece = { type: "q", color: piece.color };
    }
  }

  board.squares[toRow][toCol] = placedPiece;

  board.enPassant = null;
  if (piece.type === "p" && Math.abs(toRow - fromRow) === 2) {
    const midRow = (toRow + fromRow) / 2;
    const leftCol = cyclicCol(toCol, -1);
    const rightCol = cyclicCol(toCol, 1);
    const left = board.squares[toRow][leftCol];
    const right = board.squares[toRow][rightCol];
    if ((left && left.color !== movingColor && left.type === "p") || (right && right.color !== movingColor && right.type === "p")) {
      board.enPassant = { row: midRow, col: toCol };
    }
  }

  let castling = board.castling;
  if (piece.type === "k") {
    castling = castling.replace(movingColor === "w" ? /[KQ]/g : /[kq]/g, "");
  }
  if (piece.type === "r") {
    if (fromRow === 0 && fromCol === 0) castling = castling.replace("Q", "");
    if (fromRow === 0 && fromCol === 7) castling = castling.replace("K", "");
    if (fromRow === 7 && fromCol === 0) castling = castling.replace("q", "");
    if (fromRow === 7 && fromCol === 7) castling = castling.replace("k", "");
  }
  if (target && target.type === "r") {
    if (toRow === 0 && toCol === 0) castling = castling.replace("Q", "");
    if (toRow === 0 && toCol === 7) castling = castling.replace("K", "");
    if (toRow === 7 && toCol === 0) castling = castling.replace("q", "");
    if (toRow === 7 && toCol === 7) castling = castling.replace("k", "");
  }
  board.castling = castling;

  if (movingColor === "b") {
    board.fullMove += 1;
  }
  board.turn = opposite(movingColor);
}

const MATE_VALUE = 1000000;
const MOBILITY_FACTOR = 5;
const REPETITION_PENALTY = 20;

interface TranspositionEntry {
  depth: number;
  value: number;
  flag: "exact" | "lower" | "upper";
  bestMove: Move | null;
}

function isEndgame(board: Board): boolean {
  let material = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (!piece) continue;
      if (piece.type === "p" || piece.type === "k") continue;
      material += pieceValues[piece.type];
    }
  }
  return material <= 1300;
}

function pieceSquareValue(piece: Piece, row: number, col: number, endgame: boolean): number {
  const r = piece.color === "w" ? row : 7 - row;
  switch (piece.type) {
    case "p":
      return pawnTable[r][col];
    case "n":
      return knightTable[r][col];
    case "b":
      return bishopTable[r][col];
    case "r":
      return rookTable[r][col];
    case "q":
      return Math.round((rookTable[r][col] + bishopTable[r][col]) / 2);
    case "k":
      return endgame ? kingTableEnd[r][col] : kingTableMid[r][col];
    default:
      return 0;
  }
}

function applyRepetitionPenalty(score: number): number {
  if (score > 0) return score - REPETITION_PENALTY;
  if (score < 0) return score + REPETITION_PENALTY;
  return score;
}

function evaluateBoard(board: Board, repetitionCount: number): number {
  const endgame = isEndgame(board);
  let score = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (!piece) continue;
      const base = pieceValues[piece.type];
      const positional = pieceSquareValue(piece, row, col, endgame);
      score += (piece.color === "w" ? 1 : -1) * (base + positional);
    }
  }

  const whiteMoves = generateAllLegalMoves(board, "w").length;
  const blackMoves = generateAllLegalMoves(board, "b").length;
  score += (whiteMoves - blackMoves) * MOBILITY_FACTOR;

  if (repetitionCount >= 3) return 0;
  if (repetitionCount === 2) return applyRepetitionPenalty(score);
  return score;
}

function isCaptureMove(board: Board, move: Move): boolean {
  if (move.isEnPassant) return true;
  const target = board.squares[move.to[0]][move.to[1]];
  return !!target;
}

function moveToKey(move: Move): string {
  return `${move.from[0]}-${move.from[1]}-${move.to[0]}-${move.to[1]}-${move.promotion ?? ""}`;
}

function movesMatch(left: Move, right: Move): boolean {
  return (
    left.from[0] === right.from[0] &&
    left.from[1] === right.from[1] &&
    left.to[0] === right.to[0] &&
    left.to[1] === right.to[1] &&
    (left.promotion ?? "") === (right.promotion ?? "")
  );
}

function scoreMove(
  board: Board,
  move: Move,
  bestMove: Move | null,
  ply: number,
  killerMoves: Move[][],
  historyScores: Map<string, number>,
): number {
  if (bestMove && movesMatch(bestMove, move)) return 1000000;
  let score = 0;
  if (isCaptureMove(board, move)) {
    const mover = board.squares[move.from[0]][move.from[1]];
    const moverValue = mover ? pieceValues[mover.type] : 0;
    const captured = move.isEnPassant
      ? pieceValues.p
      : board.squares[move.to[0]][move.to[1]]
        ? pieceValues[board.squares[move.to[0]][move.to[1]]!.type]
        : 0;
    score += 100000 + captured * 10 - moverValue;
  }
  if (killerMoves[ply]?.some((killer) => movesMatch(killer, move))) {
    score += 80000;
  }
  score += historyScores.get(moveToKey(move)) ?? 0;
  return score;
}

function orderMoves(
  board: Board,
  moves: Move[],
  bestMove: Move | null,
  ply: number,
  killerMoves: Move[][],
  historyScores: Map<string, number>,
): Move[] {
  return moves
    .map((move) => ({
      move,
      score: scoreMove(board, move, bestMove, ply, killerMoves, historyScores),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.move);
}

function storeKillerMove(killerMoves: Move[][], ply: number, move: Move): void {
  if (!killerMoves[ply]) killerMoves[ply] = [];
  const list = killerMoves[ply];
  if (list.some((killer) => movesMatch(killer, move))) return;
  list.unshift(move);
  if (list.length > 2) list.pop();
}

function search(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  repetitionCounts: Map<string, number>,
  ply: number,
  tt: Map<string, TranspositionEntry>,
  killerMoves: Move[][],
  historyScores: Map<string, number>,
): number {
  if (board.halfMove >= 100) return 0;
  const hash = hashBoard(board);
  const repetitionCount = repetitionCounts.get(hash) ?? 0;
  if (repetitionCount >= 3) return 0;

  const alphaOriginal = alpha;
  const betaOriginal = beta;

  if (repetitionCount === 0) {
    const entry = tt.get(hash);
    if (entry && entry.depth >= depth) {
      if (entry.flag === "exact") return entry.value;
      if (entry.flag === "lower") alpha = Math.max(alpha, entry.value);
      if (entry.flag === "upper") beta = Math.min(beta, entry.value);
      if (alpha >= beta) return entry.value;
    }
  }

  if (depth === 0) {
    return evaluateBoard(board, repetitionCount);
  }

  const legalMoves = generateAllLegalMoves(board, board.turn);
  if (legalMoves.length === 0) {
    if (isInCheck(board, board.turn)) {
      return board.turn === "w" ? -MATE_VALUE : MATE_VALUE;
    }
    return 0;
  }

  const bestEntryMove = repetitionCount === 0 ? tt.get(hash)?.bestMove ?? null : null;
  const orderedMoves = orderMoves(board, legalMoves, bestEntryMove, ply, killerMoves, historyScores);
  const maximizing = board.turn === "w";
  let bestValue = maximizing ? -Infinity : Infinity;
  let bestMove: Move | null = null;

  for (const move of orderedMoves) {
    const next = cloneBoard(board);
    applyMove(next, move);
    const nextHash = hashBoard(next);
    repetitionCounts.set(nextHash, (repetitionCounts.get(nextHash) ?? 0) + 1);

    const score = search(
      next,
      depth - 1,
      alpha,
      beta,
      repetitionCounts,
      ply + 1,
      tt,
      killerMoves,
      historyScores,
    );

    const nextCount = (repetitionCounts.get(nextHash) ?? 1) - 1;
    if (nextCount <= 0) {
      repetitionCounts.delete(nextHash);
    } else {
      repetitionCounts.set(nextHash, nextCount);
    }

    if (maximizing) {
      if (score > bestValue) {
        bestValue = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestValue);
    } else {
      if (score < bestValue) {
        bestValue = score;
        bestMove = move;
      }
      beta = Math.min(beta, bestValue);
    }

    if (alpha >= beta) {
      if (!isCaptureMove(board, move)) {
        storeKillerMove(killerMoves, ply, move);
        const key = moveToKey(move);
        historyScores.set(key, (historyScores.get(key) ?? 0) + depth * depth);
      }
      break;
    }
  }

  if (repetitionCount === 0) {
    let flag: TranspositionEntry["flag"] = "exact";
    if (bestValue <= alphaOriginal) flag = "upper";
    else if (bestValue >= betaOriginal) flag = "lower";
    tt.set(hash, { depth, value: bestValue, flag, bestMove });
  }

  return bestValue;
}

function searchRoot(
  board: Board,
  depth: number,
  repetitionCounts: Map<string, number>,
  tt: Map<string, TranspositionEntry>,
  killerMoves: Move[][],
  historyScores: Map<string, number>,
  bestMoveHint: Move | null,
): { value: number; bestMove: Move | null } {
  if (board.halfMove >= 100) {
    return { value: 0, bestMove: null };
  }
  const legalMoves = generateAllLegalMoves(board, board.turn);
  if (legalMoves.length === 0) {
    const value = isInCheck(board, board.turn)
      ? board.turn === "w"
        ? -MATE_VALUE
        : MATE_VALUE
      : 0;
    return { value, bestMove: null };
  }

  const orderedMoves = orderMoves(board, legalMoves, bestMoveHint, 0, killerMoves, historyScores);
  const maximizing = board.turn === "w";
  let bestValue = maximizing ? -Infinity : Infinity;
  let bestMove: Move | null = null;
  let alpha = -Infinity;
  let beta = Infinity;

  for (const move of orderedMoves) {
    const next = cloneBoard(board);
    applyMove(next, move);
    const nextHash = hashBoard(next);
    repetitionCounts.set(nextHash, (repetitionCounts.get(nextHash) ?? 0) + 1);

    const score = search(
      next,
      depth - 1,
      alpha,
      beta,
      repetitionCounts,
      1,
      tt,
      killerMoves,
      historyScores,
    );

    const nextCount = (repetitionCounts.get(nextHash) ?? 1) - 1;
    if (nextCount <= 0) {
      repetitionCounts.delete(nextHash);
    } else {
      repetitionCounts.set(nextHash, nextCount);
    }

    if (maximizing) {
      if (score > bestValue) {
        bestValue = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestValue);
    } else {
      if (score < bestValue) {
        bestValue = score;
        bestMove = move;
      }
      beta = Math.min(beta, bestValue);
    }
  }

  return { value: bestValue, bestMove };
}

function getBestMove(board: Board, depth: number, repetitionHistory: string[]): Move | null {
  if (board.halfMove >= 100) return null;
  const repetitionCounts = buildRepetitionCounts(repetitionHistory);
  const currentHash = hashBoard(board);
  if (!repetitionCounts.has(currentHash)) {
    repetitionCounts.set(currentHash, 1);
  }

  const tt = new Map<string, TranspositionEntry>();
  const killerMoves: Move[][] = Array.from({ length: depth + 4 }, () => []);
  const historyScores = new Map<string, number>();
  let bestMove: Move | null = null;

  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    const result = searchRoot(
      board,
      currentDepth,
      repetitionCounts,
      tt,
      killerMoves,
      historyScores,
      bestMove,
    );
    if (result.bestMove) {
      bestMove = result.bestMove;
    }
  }

  return bestMove;
}

self.addEventListener("message", (event: MessageEvent<WorkerSearchRequest>) => {
  const data = event.data;
  if (!data || data.type !== "search") return;
  const move = getBestMove(data.board, data.depth, data.repetitionHistory);
  const response: WorkerSearchResult = {
    type: "result",
    id: data.id,
    turn: data.board.turn,
    move,
  };
  (self as DedicatedWorkerGlobalScope).postMessage(response);
});
