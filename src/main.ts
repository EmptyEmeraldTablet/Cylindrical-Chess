import "./style.css";
import {
  faChessBishop,
  faChessKing,
  faChessKnight,
  faChessPawn,
  faChessQueen,
  faChessRook,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";

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

type PlayerType = "human" | "ai";

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

const canvas = document.getElementById("boardCanvas") as HTMLCanvasElement;
const statusText = document.getElementById("statusText") as HTMLParagraphElement;
const turnLabel = document.getElementById("turnLabel") as HTMLDivElement;
const viewLeftBtn = document.getElementById("viewLeftBtn") as HTMLButtonElement;
const viewRightBtn = document.getElementById("viewRightBtn") as HTMLButtonElement;
const viewCenterBtn = document.getElementById("viewCenterBtn") as HTMLButtonElement;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const stepBtn = document.getElementById("stepBtn") as HTMLButtonElement;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;
const saveFenBtn = document.getElementById("saveFenBtn") as HTMLButtonElement;
const exportFenBtn = document.getElementById("exportFenBtn") as HTMLButtonElement;
const loadFenBtn = document.getElementById("loadFenBtn") as HTMLButtonElement;
const fenInput = document.getElementById("fenInput") as HTMLTextAreaElement;
const aiDelaySlider = document.getElementById("aiDelay") as HTMLInputElement;
const aiDelayValue = document.getElementById("aiDelayValue") as HTMLSpanElement;
const aiDepthWhite = document.getElementById("aiDepthWhite") as HTMLInputElement;
const aiDepthWhiteValue = document.getElementById("aiDepthWhiteValue") as HTMLSpanElement;
const aiDepthBlack = document.getElementById("aiDepthBlack") as HTMLInputElement;
const aiDepthBlackValue = document.getElementById("aiDepthBlackValue") as HTMLSpanElement;
const promotionOverlay = document.getElementById("promotionOverlay") as HTMLDivElement;

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Canvas context not available");
}

const iconMap: Record<PieceType, IconDefinition> = {
  p: faChessPawn,
  n: faChessKnight,
  b: faChessBishop,
  r: faChessRook,
  q: faChessQueen,
  k: faChessKing,
};

function buildIconData(icon: IconDefinition): { path: Path2D; width: number; height: number } {
  const [width, height, , , svgPathData] = icon.icon;
  const pathData = Array.isArray(svgPathData) ? svgPathData[0] : svgPathData;
  return { path: new Path2D(pathData), width, height };
}

const iconData: Record<PieceType, { path: Path2D; width: number; height: number }> = {
  p: buildIconData(iconMap.p),
  n: buildIconData(iconMap.n),
  b: buildIconData(iconMap.b),
  r: buildIconData(iconMap.r),
  q: buildIconData(iconMap.q),
  k: buildIconData(iconMap.k),
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
const repetitionHistory: string[] = [];
const repetitionCounts = new Map<string, number>();

const state = {
  board: initialBoard(),
  baseCol: 0,
  snapBaseCol: 0,
  dragging: false,
  dragMoved: false,
  dragStartX: 0,
  dragStartBaseCol: 0,
  selected: null as { row: number; col: number } | null,
  legalMoves: [] as Move[],
  mode: "hvh",
  players: ["human", "human"] as [PlayerType, PlayerType],
  aiDelay: 500,
  aiDepthWhite: 3,
  aiDepthBlack: 3,
  aiAuto: true,
  paused: false,
  aiThinking: false,
  pendingPromotion: null as Move | null,
  boardSize: 480,
  squareSize: 60,
};

const aiWorker = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
let aiRequestId = 0;
let pendingAiTurn: Color | null = null;

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

function cyclicCol(col: number, delta: number): number {
  return mod(col + delta, 8);
}

function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function getDepthForColor(color: Color): number {
  return color === "w" ? state.aiDepthWhite : state.aiDepthBlack;
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

function recordRepetition(board: Board): void {
  const key = hashBoard(board);
  repetitionHistory.push(key);
  repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);
}

function resetRepetition(board: Board): void {
  repetitionHistory.length = 0;
  repetitionCounts.clear();
  recordRepetition(board);
}

function getRepetitionCount(board: Board): number {
  return repetitionCounts.get(hashBoard(board)) ?? 0;
}

function colToFile(col: number): string {
  return String.fromCharCode(97 + col);
}

function fileToCol(file: string): number {
  return file.charCodeAt(0) - 97;
}

function createEmptySquares(): Square[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));
}

function initialBoard(): Board {
  const squares = createEmptySquares();
  const backRank: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];

  for (let col = 0; col < 8; col += 1) {
    squares[0][col] = { type: backRank[col], color: "w" };
    squares[1][col] = { type: "p", color: "w" };
    squares[6][col] = { type: "p", color: "b" };
    squares[7][col] = { type: backRank[col], color: "b" };
  }

  return {
    squares,
    turn: "w",
    castling: "KQkq",
    enPassant: null,
    halfMove: 0,
    fullMove: 1,
    gameOver: false,
    winner: null,
  };
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

function updateGameState(board: Board): void {
  if (getRepetitionCount(board) >= 3) {
    board.gameOver = true;
    board.winner = "draw";
    return;
  }
  if (board.halfMove >= 100) {
    board.gameOver = true;
    board.winner = "draw";
    return;
  }
  const legalMoves = generateAllLegalMoves(board, board.turn);
  if (legalMoves.length === 0) {
    if (isInCheck(board, board.turn)) {
      board.gameOver = true;
      board.winner = opposite(board.turn);
    } else {
      board.gameOver = true;
      board.winner = "draw";
    }
  } else {
    board.gameOver = false;
    board.winner = null;
  }
}

function boardToFEN(board: Board): string {
  const rows: string[] = [];
  for (let row = 7; row >= 0; row -= 1) {
    let empty = 0;
    let rowStr = "";
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (!piece) {
        empty += 1;
      } else {
        if (empty > 0) {
          rowStr += empty.toString();
          empty = 0;
        }
        const letter = piece.type;
        rowStr += piece.color === "w" ? letter.toUpperCase() : letter;
      }
    }
    if (empty > 0) {
      rowStr += empty.toString();
    }
    rows.push(rowStr);
  }

  const castling = board.castling.length > 0 ? board.castling : "-";
  const enPassant = board.enPassant
    ? `${colToFile(board.enPassant.col)}${board.enPassant.row + 1}`
    : "-";

  return `${rows.join("/")} ${board.turn} ${castling} ${enPassant} ${board.halfMove} ${board.fullMove}`;
}

function loadFEN(fen: string): Board | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) return null;
  const [boardPart, turnPart, castlingPart, epPart, halfPart, fullPart] = parts;
  const ranks = boardPart.split("/");
  if (ranks.length !== 8) return null;

  const squares = createEmptySquares();
  for (let i = 0; i < 8; i += 1) {
    const rank = ranks[i];
    let col = 0;
    for (const char of rank) {
      if (col >= 8) return null;
      if (/\d/.test(char)) {
        col += Number(char);
      } else {
        const isUpper = char === char.toUpperCase();
        const type = char.toLowerCase() as PieceType;
        if (!["p", "n", "b", "r", "q", "k"].includes(type)) return null;
        const row = 7 - i;
        squares[row][col] = { type, color: isUpper ? "w" : "b" };
        col += 1;
      }
    }
    if (col !== 8) return null;
  }

  const turn = turnPart === "w" ? "w" : "b";
  const castling = castlingPart === "-" ? "" : castlingPart;
  const enPassant =
    epPart === "-"
      ? null
      : {
          col: fileToCol(epPart[0]),
          row: Number(epPart[1]) - 1,
        };
  const halfMove = Number(halfPart);
  const fullMove = Number(fullPart);
  if (Number.isNaN(halfMove) || Number.isNaN(fullMove)) return null;

  return {
    squares,
    turn,
    castling,
    enPassant,
    halfMove,
    fullMove,
    gameOver: false,
    winner: null,
  };
}

function getViewState(): { startCol: number; frac: number } {
  const normalized = mod(state.baseCol, 8);
  const startCol = Math.floor(normalized);
  const frac = normalized - startCol;
  return { startCol, frac };
}

function rowToY(row: number): number {
  return (7 - row) * state.squareSize;
}

function colToX(col: number): number {
  const { startCol, frac } = getViewState();
  const delta = mod(col - startCol, 8) - frac;
  return delta * state.squareSize;
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const size = Math.floor(Math.min(rect.width, rect.height));
  if (size <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  state.boardSize = size;
  state.squareSize = size / 8;
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function drawBoard(): void {
  ctx.clearRect(0, 0, state.boardSize, state.boardSize);
  const { startCol, frac } = getViewState();
  for (let i = 0; i <= 8; i += 1) {
    const col = mod(startCol + i, 8);
    const x = (i - frac) * state.squareSize;
    if (x + state.squareSize <= 0 || x >= state.boardSize) continue;
    for (let row = 0; row < 8; row += 1) {
      const y = rowToY(row);
      const isDark = (row + col) % 2 === 0;
      ctx.fillStyle = isDark ? "#b0744e" : "#f3d9ae";
      ctx.fillRect(x, y, state.squareSize, state.squareSize);
    }
  }
}

function drawPieces(): void {
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = state.board.squares[row][col];
      if (!piece) continue;
      const x = colToX(col);
      const y = rowToY(row);
      if (x + state.squareSize <= 0 || x >= state.boardSize) continue;
      const cx = x + state.squareSize / 2;
      const cy = y + state.squareSize / 2;
      const radius = state.squareSize * 0.38;

      ctx.save();
      ctx.shadowColor = piece.color === "w" ? "rgba(0, 0, 0, 0.18)" : "rgba(0, 0, 0, 0.28)";
      ctx.shadowBlur = state.squareSize * 0.12;
      ctx.shadowOffsetY = state.squareSize * 0.05;
      ctx.fillStyle = piece.color === "w" ? "#fdf1d2" : "#2f241f";
      ctx.strokeStyle = piece.color === "w" ? "rgba(136, 99, 70, 0.5)" : "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = state.squareSize * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      const icon = iconData[piece.type];
      const targetSize = state.squareSize * 0.58;
      const scale = targetSize / Math.max(icon.width, icon.height);
      ctx.save();
      ctx.translate(cx, cy + state.squareSize * 0.02);
      ctx.scale(scale, scale);
      ctx.translate(-icon.width / 2, -icon.height / 2);
      ctx.fillStyle = piece.color === "w" ? "#3a2c28" : "#fdf1d2";
      ctx.fill(icon.path);
      ctx.restore();
    }
  }
}

function drawHighlights(): void {
  if (state.selected) {
    const { row, col } = state.selected;
    const x = colToX(col);
    const y = rowToY(row);
    if (x + state.squareSize > 0 && x < state.boardSize) {
      ctx.strokeStyle = "rgba(44, 95, 108, 0.85)";
      ctx.lineWidth = state.squareSize * 0.06;
      ctx.strokeRect(x + 2, y + 2, state.squareSize - 4, state.squareSize - 4);
    }
  }

  for (const move of state.legalMoves) {
    const [row, col] = move.to;
    const x = colToX(col);
    const y = rowToY(row);
    if (x + state.squareSize <= 0 || x >= state.boardSize) continue;
    const cx = x + state.squareSize / 2;
    const cy = y + state.squareSize / 2;
    const target = state.board.squares[row][col];
    const isCapture = !!target || move.isEnPassant;
    if (isCapture) {
      ctx.strokeStyle = "rgba(208, 107, 46, 0.75)";
      ctx.lineWidth = state.squareSize * 0.08;
      ctx.beginPath();
      ctx.arc(cx, cy, state.squareSize * 0.38, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(44, 95, 108, 0.4)";
      ctx.beginPath();
      ctx.arc(cx, cy, state.squareSize * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (isInCheck(state.board, state.board.turn)) {
    const king = findKing(state.board, state.board.turn);
    if (king) {
      const x = colToX(king.col);
      const y = rowToY(king.row);
      if (x + state.squareSize > 0 && x < state.boardSize) {
        ctx.strokeStyle = "rgba(165, 47, 47, 0.85)";
        ctx.lineWidth = state.squareSize * 0.08;
        ctx.strokeRect(x + 3, y + 3, state.squareSize - 6, state.squareSize - 6);
      }
    }
  }
}

function draw(): void {
  drawBoard();
  drawHighlights();
  drawPieces();
}

function movesMatch(left: Move, right: Move): boolean {
  const leftPromotion = left.promotion ?? null;
  const rightPromotion = right.promotion ?? null;
  return (
    left.from[0] === right.from[0] &&
    left.from[1] === right.from[1] &&
    left.to[0] === right.to[0] &&
    left.to[1] === right.to[1] &&
    leftPromotion === rightPromotion
  );
}

function cancelAiSearch(): void {
  aiRequestId += 1;
  pendingAiTurn = null;
  state.aiThinking = false;
}

aiWorker.addEventListener("message", (event: MessageEvent<WorkerSearchResult>) => {
  const data = event.data;
  if (!data || data.type !== "result") return;
  if (data.id !== aiRequestId) return;
  if (pendingAiTurn && data.turn !== pendingAiTurn) {
    state.aiThinking = false;
    pendingAiTurn = null;
    return;
  }

  state.aiThinking = false;
  pendingAiTurn = null;

  if (!data.move) return;
  if (state.board.gameOver || state.pendingPromotion) return;
  if (state.mode === "aivai" && !state.aiAuto) return;
  if (state.paused) return;
  if (state.board.turn !== data.turn) return;

  const legalMoves = generateAllLegalMoves(state.board, state.board.turn);
  const matchedMove = legalMoves.find((move) => movesMatch(move, data.move!));
  if (!matchedMove) return;

  applyMove(state.board, matchedMove);
  recordRepetition(state.board);
  updateGameState(state.board);
  resetSelection();
  scheduleNextTurn();
});

aiWorker.addEventListener("error", () => {
  state.aiThinking = false;
  pendingAiTurn = null;
});

function simplifyMovesForUI(moves: Move[]): Move[] {
  const map = new Map<string, Move>();
  for (const move of moves) {
    const key = `${move.from[0]}-${move.from[1]}-${move.to[0]}-${move.to[1]}`;
    if (!map.has(key)) {
      map.set(key, { ...move, promotion: undefined });
    }
  }
  return Array.from(map.values());
}

function updateStatus(): void {
  if (!state.board.gameOver && state.mode === "aivai" && !state.aiAuto) {
    statusText.textContent = "等待开始";
    turnLabel.textContent = "机器对弈待机";
    return;
  }
  if (state.board.gameOver) {
    if (state.board.winner === "draw") {
      if (getRepetitionCount(state.board) >= 3) {
        statusText.textContent = "三次重复和棋";
      } else if (state.board.halfMove >= 100) {
        statusText.textContent = "50步和棋";
      } else {
        statusText.textContent = "和棋";
      }
      turnLabel.textContent = "对局结束";
    } else if (state.board.winner === "w") {
      statusText.textContent = "白方胜";
      turnLabel.textContent = "白方将死";
    } else {
      statusText.textContent = "黑方胜";
      turnLabel.textContent = "黑方将死";
    }
    return;
  }

  const turnName = state.board.turn === "w" ? "白方" : "黑方";
  const inCheck = isInCheck(state.board, state.board.turn);
  statusText.textContent = inCheck ? `${turnName}被将军` : `${turnName}走棋`;
  turnLabel.textContent = inCheck ? `${turnName}被将军` : `${turnName}回合`;
}

function updateButtons(): void {
  const aiVsAi = state.mode === "aivai";
  startBtn.disabled = !aiVsAi || state.aiAuto || state.board.gameOver;
  pauseBtn.disabled = !aiVsAi || !state.aiAuto || state.board.gameOver;
  pauseBtn.textContent = state.paused ? "继续" : "暂停";
  stepBtn.disabled = !aiVsAi || !state.aiAuto || !state.paused || state.board.gameOver;
}

function updateDepthLabels(): void {
  aiDepthWhiteValue.textContent = `${state.aiDepthWhite} 层`;
  aiDepthBlackValue.textContent = `${state.aiDepthBlack} 层`;
}

function updateDepthControls(): void {
  const whiteAI = state.players[0] === "ai";
  const blackAI = state.players[1] === "ai";
  aiDepthWhite.disabled = !whiteAI;
  aiDepthBlack.disabled = !blackAI;
}

function resetSelection(): void {
  state.selected = null;
  state.legalMoves = [];
}

function resetGame(): void {
  cancelAiSearch();
  state.board = initialBoard();
  state.baseCol = 0;
  state.snapBaseCol = 0;
  state.aiAuto = state.mode !== "aivai";
  state.paused = false;
  state.pendingPromotion = null;
  resetRepetition(state.board);
  resetSelection();
  updateGameState(state.board);
  updateStatus();
  updateButtons();
  updateDepthControls();
  updateDepthLabels();
  draw();
  scheduleNextTurn();
}

function setMode(mode: string): void {
  state.mode = mode;
  switch (mode) {
    case "hvai":
      state.players = ["human", "ai"];
      break;
    case "aivh":
      state.players = ["ai", "human"];
      break;
    case "aivai":
      state.players = ["ai", "ai"];
      break;
    default:
      state.players = ["human", "human"];
      break;
  }
  resetGame();
}

function isHumanTurn(): boolean {
  const index = state.board.turn === "w" ? 0 : 1;
  return state.players[index] === "human";
}

function scheduleNextTurn(): void {
  updateStatus();
  updateButtons();
  draw();
  if (state.board.gameOver) return;
  if (state.mode === "aivai" && !state.aiAuto) return;
  if (!isHumanTurn()) {
    triggerAiMove(false);
  }
}

function triggerAiMove(force: boolean): void {
  if (state.aiThinking) return;
  if (state.pendingPromotion) return;
  if (state.board.gameOver) return;
  if (isHumanTurn()) return;
  if (state.paused && !force) return;

  const requestId = ++aiRequestId;
  const requestTurn = state.board.turn;
  state.aiThinking = true;
  const delay = force ? 0 : state.aiDelay;
  window.setTimeout(() => {
    if (requestId !== aiRequestId) return;
    if (state.board.gameOver || state.pendingPromotion) {
      state.aiThinking = false;
      pendingAiTurn = null;
      return;
    }
    if (state.mode === "aivai" && !state.aiAuto) {
      state.aiThinking = false;
      pendingAiTurn = null;
      return;
    }
    if (state.paused && !force) {
      state.aiThinking = false;
      pendingAiTurn = null;
      return;
    }
    if (state.board.turn !== requestTurn || isHumanTurn()) {
      state.aiThinking = false;
      pendingAiTurn = null;
      return;
    }

    const depth = getDepthForColor(requestTurn);
    pendingAiTurn = requestTurn;
    aiWorker.postMessage({
      type: "search",
      id: requestId,
      board: cloneBoard(state.board),
      depth,
      repetitionHistory: [...repetitionHistory],
    } satisfies WorkerSearchRequest);
  }, delay);
}

function handlePromotionChoice(type: PieceType): void {
  if (!state.pendingPromotion) return;
  const move = { ...state.pendingPromotion, promotion: type };
  state.pendingPromotion = null;
  promotionOverlay.classList.remove("show");
  promotionOverlay.setAttribute("aria-hidden", "true");
  applyMove(state.board, move);
  recordRepetition(state.board);
  updateGameState(state.board);
  resetSelection();
  scheduleNextTurn();
}

function attemptMove(move: Move): void {
  const [toRow] = move.to;
  const movingPiece = state.board.squares[move.from[0]][move.from[1]];
  if (!movingPiece) return;
  if (movingPiece.type === "p") {
    const promotionRow = movingPiece.color === "w" ? 7 : 0;
    if (toRow === promotionRow && !move.promotion && isHumanTurn()) {
      state.pendingPromotion = move;
      promotionOverlay.classList.add("show");
      promotionOverlay.setAttribute("aria-hidden", "false");
      return;
    }
  }
  applyMove(state.board, move);
  recordRepetition(state.board);
  updateGameState(state.board);
  resetSelection();
  scheduleNextTurn();
}

function getBoardCoords(event: PointerEvent): { row: number; col: number } | null {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const colIndex = Math.floor(x / state.squareSize);
  const rowIndex = 7 - Math.floor(y / state.squareSize);
  const col = mod(state.snapBaseCol + colIndex, 8);
  return { row: rowIndex, col };
}

function handleBoardClick(event: PointerEvent): void {
  if (state.pendingPromotion) return;
  if (!isHumanTurn() || state.board.gameOver || state.aiThinking) return;
  const coords = getBoardCoords(event);
  if (!coords) return;
  const { row, col } = coords;
  const piece = state.board.squares[row][col];

  const move = state.legalMoves.find((candidate) => candidate.to[0] === row && candidate.to[1] === col);
  if (move) {
    attemptMove(move);
    return;
  }

  if (piece && piece.color === state.board.turn) {
    state.selected = { row, col };
    const legalMoves = generateAllLegalMoves(state.board, piece.color).filter(
      (candidate) => candidate.from[0] === row && candidate.from[1] === col,
    );
    state.legalMoves = simplifyMovesForUI(legalMoves);
  } else {
    resetSelection();
  }
  draw();
}

canvas.addEventListener("pointerdown", (event) => {
  if (state.pendingPromotion) return;
  state.dragging = true;
  state.dragMoved = false;
  state.dragStartX = event.clientX;
  state.dragStartBaseCol = state.baseCol;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const dx = event.clientX - state.dragStartX;
  if (Math.abs(dx) > 6) {
    state.dragMoved = true;
  }
  state.baseCol = mod(state.dragStartBaseCol - dx / state.squareSize, 8);
  draw();
});

function endDrag(event: PointerEvent): void {
  if (!state.dragging) return;
  state.dragging = false;
  canvas.releasePointerCapture(event.pointerId);
  state.baseCol = mod(Math.round(state.baseCol), 8);
  state.snapBaseCol = state.baseCol;
  draw();
  if (!state.dragMoved) {
    handleBoardClick(event);
  }
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointerleave", endDrag);
canvas.addEventListener("pointercancel", endDrag);

viewLeftBtn.addEventListener("click", () => {
  state.baseCol = mod(state.baseCol - 1, 8);
  state.snapBaseCol = mod(state.snapBaseCol - 1, 8);
  draw();
});

viewRightBtn.addEventListener("click", () => {
  state.baseCol = mod(state.baseCol + 1, 8);
  state.snapBaseCol = mod(state.snapBaseCol + 1, 8);
  draw();
});

viewCenterBtn.addEventListener("click", () => {
  state.baseCol = 0;
  state.snapBaseCol = 0;
  draw();
});

startBtn.addEventListener("click", () => {
  if (state.mode !== "aivai" || state.aiAuto || state.board.gameOver) return;
  state.aiAuto = true;
  state.paused = false;
  scheduleNextTurn();
});

pauseBtn.addEventListener("click", () => {
  if (state.mode !== "aivai" || !state.aiAuto) return;
  state.paused = !state.paused;
  updateButtons();
  if (!state.paused) {
    scheduleNextTurn();
  }
});

stepBtn.addEventListener("click", () => {
  if (state.mode !== "aivai" || !state.aiAuto || !state.paused) return;
  triggerAiMove(true);
});

resetBtn.addEventListener("click", () => {
  resetGame();
});

saveFenBtn.addEventListener("click", () => {
  fenInput.value = boardToFEN(state.board);
});

exportFenBtn.addEventListener("click", () => {
  const fen = boardToFEN(state.board);
  fenInput.value = fen;
  const blob = new Blob([fen], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cylindrical-chess-${new Date().toISOString().replace(/[:.]/g, "-")}.fen`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
});

loadFenBtn.addEventListener("click", () => {
  const loaded = loadFEN(fenInput.value);
  if (!loaded) {
    statusText.textContent = "FEN 格式错误";
    return;
  }
  cancelAiSearch();
  state.board = loaded;
  state.baseCol = 0;
  state.snapBaseCol = 0;
  state.pendingPromotion = null;
  resetRepetition(state.board);
  resetSelection();
  updateGameState(state.board);
  scheduleNextTurn();
});

aiDelaySlider.addEventListener("input", () => {
  state.aiDelay = Number(aiDelaySlider.value);
  aiDelayValue.textContent = `${state.aiDelay} ms`;
});

aiDepthWhite.addEventListener("input", () => {
  state.aiDepthWhite = Number(aiDepthWhite.value);
  updateDepthLabels();
});

aiDepthBlack.addEventListener("input", () => {
  state.aiDepthBlack = Number(aiDepthBlack.value);
  updateDepthLabels();
});

document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => setMode(input.value));
});

promotionOverlay.querySelectorAll<HTMLButtonElement>("button[data-piece]").forEach((button) => {
  button.addEventListener("click", () => {
    const piece = button.dataset.piece as PieceType;
    handlePromotionChoice(piece);
  });
});

window.addEventListener("resize", () => {
  resizeCanvas();
});

updateButtons();
updateStatus();
aiDelayValue.textContent = `${state.aiDelay} ms`;
updateDepthLabels();
updateDepthControls();
resetRepetition(state.board);
resizeCanvas();
scheduleNextTurn();
