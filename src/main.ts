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
type Language = "zh" | "en";

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
const flipBoardBtn = document.getElementById("flipBoardBtn") as HTMLButtonElement;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const stepBtn = document.getElementById("stepBtn") as HTMLButtonElement;
const undoBtn = document.getElementById("undoBtn") as HTMLButtonElement;
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
const hoverPreviewToggle = document.getElementById("hoverPreviewToggle") as HTMLInputElement;
const languageSelect = document.getElementById("languageSelect") as HTMLSelectElement;

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
const DRAG_THRESHOLD_PX = 6;
const languageStorageKey = "col-chess-language";

function resolveInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(languageStorageKey);
    if (stored === "zh" || stored === "en") {
      return stored;
    }
  } catch {
    // Ignore storage errors and fall back to defaults.
  }

  return "en";
}

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
const boardHistory: Board[] = [];

const state = {
  board: initialBoard(),
  baseCol: 0,
  snapBaseCol: 0,
  language: resolveInitialLanguage(),
  dragging: false,
  dragMoved: false,
  dragStartX: 0,
  dragStartBaseCol: 0,
  dragPointerId: null as number | null,
  selected: null as { row: number; col: number } | null,
  legalMoves: [] as Move[],
  illegalMoves: [] as Move[],
  hovered: null as { row: number; col: number } | null,
  hoverMoves: [] as Move[],
  hoverIllegalMoves: [] as Move[],
  mode: "hvh",
  players: ["human", "human"] as [PlayerType, PlayerType],
  aiDelay: 500,
  aiDepthWhite: 3,
  aiDepthBlack: 3,
  aiAuto: true,
  paused: false,
  aiThinking: false,
  pendingPromotion: null as Move | null,
  flipBoard: false,
  hoverPreview: false,
  boardSize: 480,
  squareSize: 60,
  pinnedPieces: new Set<string>(),
  forceStepRequestId: null as number | null,
};

const translations = {
  zh: {
    title: "圆柱面国际象棋",
    eyebrow: "Cylindrical Chess",
    subtitle: "横向循环棋盘 · Canvas 实时渲染 · AI 对弈与视角滚动",
    link_github: "GitHub 源码",
    status_label: "对局状态",
    status_loading: "载入中...",
    view_left: "视角左移",
    view_center: "回正",
    view_right: "视角右移",
    view_flip: "翻转棋盘",
    board_tip: "提示：拖动棋盘可平滑滚动列视角，点击棋子显示落子范围。",
    section_mode: "对弈模式",
    mode_hvh: "人人对弈",
    mode_hvai: "人机对弈（白方人类）",
    mode_aivh: "人机对弈（黑方人类）",
    mode_aivai: "机器对弈",
    section_ai_control: "AI 控制",
    label_ai_delay: "AI 延时",
    delay_value: "{value} ms",
    btn_start: "开始",
    btn_pause: "暂停",
    btn_resume: "继续",
    btn_step: "单步执行",
    btn_undo: "悔棋",
    btn_reset: "重置棋局",
    section_ai_depth: "AI 深度",
    label_depth_white: "白方深度",
    label_depth_black: "黑方深度",
    depth_value: "{value} 层",
    helper_depth: "人机模式仅启用 AI 方；机器对弈可分别设置双方深度。",
    section_interaction: "交互显示",
    label_hover_preview: "悬停预览走法",
    helper_hover_preview: "开启后，悬停在任意棋子上即可显示可走与吃子提示。",
    section_language: "界面语言",
    label_language: "语言",
    lang_zh: "中文",
    lang_en: "English",
    section_fen: "棋局保存与加载",
    placeholder_fen: "在此粘贴或生成 FEN",
    btn_save_fen: "生成 FEN",
    btn_export_fen: "导出文件",
    btn_load_fen: "加载 FEN",
    section_tips: "提示",
    tip_1: "横向相邻列包含循环边界（a 与 h 相邻）。",
    tip_2: "AI 默认深度为 3，适合展示规则效果。",
    tip_3: "支持吃过路兵、易位、升变与将死判断。",
    tip_4: "三次重复或 50 步无兵移动/吃子自动和棋。",
    promotion_title: "兵升变",
    promo_q: "后",
    promo_r: "车",
    promo_b: "象",
    promo_n: "马",
    board_aria: "棋盘",
    status_waiting: "等待开始",
    status_ai_standby: "机器对弈待机",
    status_draw_repetition: "三次重复和棋",
    status_draw_50: "50步和棋",
    status_draw: "和棋",
    status_game_over: "对局结束",
    status_white_win: "白方胜",
    status_white_mate: "白方将死",
    status_black_win: "黑方胜",
    status_black_mate: "黑方将死",
    color_white: "白方",
    color_black: "黑方",
    status_check: "{color}被将军",
    status_move: "{color}走棋",
    status_turn: "{color}回合",
    error_fen: "FEN 格式错误",
  },
  en: {
    title: "Cylindrical Chess",
    eyebrow: "Cylindrical Chess",
    subtitle: "Horizontal wrap board · Canvas rendering · AI play and view scroll",
    link_github: "GitHub",
    status_label: "Game Status",
    status_loading: "Loading...",
    view_left: "View Left",
    view_center: "Center",
    view_right: "View Right",
    view_flip: "Flip Board",
    board_tip: "Tip: drag to scroll columns, click a piece to see legal moves.",
    section_mode: "Game Mode",
    mode_hvh: "Human vs Human",
    mode_hvai: "Human vs AI (White)",
    mode_aivh: "Human vs AI (Black)",
    mode_aivai: "AI vs AI",
    section_ai_control: "AI Control",
    label_ai_delay: "AI Delay",
    delay_value: "{value} ms",
    btn_start: "Start",
    btn_pause: "Pause",
    btn_resume: "Resume",
    btn_step: "Step",
    btn_undo: "Undo",
    btn_reset: "Reset",
    section_ai_depth: "AI Depth",
    label_depth_white: "White Depth",
    label_depth_black: "Black Depth",
    depth_value: "{value} ply",
    helper_depth: "Human vs AI enables only the AI side; AI vs AI supports both depths.",
    section_interaction: "Interaction",
    label_hover_preview: "Hover Move Preview",
    helper_hover_preview: "When enabled, hover a piece to preview its legal moves.",
    section_language: "Language",
    label_language: "Language",
    lang_zh: "中文",
    lang_en: "English",
    section_fen: "Save & Load",
    placeholder_fen: "Paste or generate FEN here",
    btn_save_fen: "Generate FEN",
    btn_export_fen: "Export File",
    btn_load_fen: "Load FEN",
    section_tips: "Tips",
    tip_1: "Adjacent columns wrap around (a and h are neighbors).",
    tip_2: "Default AI depth is 3 for demonstration.",
    tip_3: "Supports en passant, castling, promotion, and checkmate.",
    tip_4: "Threefold repetition or 50-move rule leads to a draw.",
    promotion_title: "Pawn Promotion",
    promo_q: "Q",
    promo_r: "R",
    promo_b: "B",
    promo_n: "N",
    board_aria: "Chessboard",
    status_waiting: "Waiting to start",
    status_ai_standby: "AI vs AI standby",
    status_draw_repetition: "Draw by repetition",
    status_draw_50: "Draw by 50-move rule",
    status_draw: "Draw",
    status_game_over: "Game Over",
    status_white_win: "White wins",
    status_white_mate: "White checkmates",
    status_black_win: "Black wins",
    status_black_mate: "Black checkmates",
    color_white: "White",
    color_black: "Black",
    status_check: "{color} in check",
    status_move: "{color} to move",
    status_turn: "{color}'s turn",
    error_fen: "Invalid FEN",
  },
} as const;

type TranslationKey = keyof typeof translations.zh;

function formatTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? "");
}

function t(key: TranslationKey): string {
  const table = translations[state.language] ?? translations.zh;
  return table[key] ?? translations.zh[key] ?? key;
}

function applyTranslations(): void {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.title = t("title");

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as TranslationKey | undefined;
    if (!key) return;
    element.textContent = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder as TranslationKey | undefined;
    if (!key) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.placeholder = t(key);
    }
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((element) => {
    const key = element.dataset.i18nAria as TranslationKey | undefined;
    if (!key) return;
    element.setAttribute("aria-label", t(key));
  });

  if (languageSelect) {
    languageSelect.value = state.language;
  }
}

function setLanguage(lang: Language, persist = true): void {
  state.language = lang;
  if (persist) {
    try {
      localStorage.setItem(languageStorageKey, lang);
    } catch {
      // Ignore storage errors.
    }
  }
  applyTranslations();
  updateStatus();
  updateButtons();
  updateDepthLabels();
  updateDelayLabel();
}

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

function pushHistory(board: Board): void {
  boardHistory.push(cloneBoard(board));
}

function resetHistory(board: Board): void {
  boardHistory.length = 0;
  pushHistory(board);
}

function popRepetition(): void {
  if (repetitionHistory.length <= 1) return;
  const last = repetitionHistory.pop();
  if (!last) return;
  const count = repetitionCounts.get(last);
  if (!count) return;
  if (count <= 1) {
    repetitionCounts.delete(last);
  } else {
    repetitionCounts.set(last, count - 1);
  }
}

function undoOnePly(): boolean {
  if (boardHistory.length <= 1) return false;
  boardHistory.pop();
  popRepetition();
  const previous = boardHistory[boardHistory.length - 1];
  state.board = cloneBoard(previous);
  return true;
}

function undoPlies(count: number): number {
  let undone = 0;
  for (let i = 0; i < count; i += 1) {
    if (!undoOnePly()) break;
    undone += 1;
  }
  return undone;
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

function updatePinnedPieces(board: Board): void {
  const pinned = new Set<string>();
  if (board.gameOver) {
    state.pinnedPieces = pinned;
    return;
  }

  const color = board.turn;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = board.squares[row][col];
      if (!piece || piece.color !== color || piece.type === "k") continue;
      const pseudoMoves = generatePseudoMovesForPiece(board, row, col, piece);
      if (pseudoMoves.length === 0) continue;
      let hasLegal = false;
      for (const move of pseudoMoves) {
        if (isMoveLegal(board, move, color)) {
          hasLegal = true;
          break;
        }
      }
      if (!hasLegal) {
        pinned.add(`${row}-${col}`);
      }
    }
  }
  state.pinnedPieces = pinned;
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
    updatePinnedPieces(board);
    return;
  }
  if (board.halfMove >= 100) {
    board.gameOver = true;
    board.winner = "draw";
    updatePinnedPieces(board);
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
  updatePinnedPieces(board);
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
  return (state.flipBoard ? row : 7 - row) * state.squareSize;
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
  requestDraw();
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

      const palette =
        piece.color === "w"
          ? {
              base: "#fdf1d2",
              stroke: "rgba(120, 86, 60, 0.45)",
              icon: "#d9c2a5",
              iconStroke: "rgba(80, 60, 45, 0.55)",
              shadow: "rgba(0, 0, 0, 0.16)",
            }
          : {
              base: "#5b463b",
              stroke: "rgba(255, 255, 255, 0.18)",
              icon: "#1c1411",
              iconStroke: "rgba(255, 255, 255, 0.18)",
              shadow: "rgba(0, 0, 0, 0.32)",
            };

      ctx.save();
      ctx.shadowColor = palette.shadow;
      ctx.shadowBlur = state.squareSize * 0.12;
      ctx.shadowOffsetY = state.squareSize * 0.05;
      ctx.fillStyle = palette.base;
      ctx.strokeStyle = palette.stroke;
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
      ctx.fillStyle = palette.icon;
      ctx.strokeStyle = palette.iconStroke;
      ctx.lineWidth = 8;
      ctx.fill(icon.path);
      ctx.stroke(icon.path);
      ctx.restore();
    }
  }
}

function drawHighlights(): void {
  if (state.pinnedPieces.size > 0 && !state.board.gameOver) {
    ctx.save();
    ctx.strokeStyle = "rgba(165, 47, 47, 0.65)";
    ctx.lineWidth = state.squareSize * 0.05;
    ctx.setLineDash([state.squareSize * 0.18, state.squareSize * 0.12]);
    for (const key of state.pinnedPieces) {
      const [rowStr, colStr] = key.split("-");
      const row = Number(rowStr);
      const col = Number(colStr);
      const x = colToX(col);
      const y = rowToY(row);
      if (x + state.squareSize <= 0 || x >= state.boardSize) continue;
      ctx.strokeRect(x + 4, y + 4, state.squareSize - 8, state.squareSize - 8);
    }
    ctx.restore();
  }

  const active =
    state.selected ??
    (state.hoverPreview && state.hovered ? state.hovered : null);
  const isHover = !state.selected && !!active;
  const legalMoves = state.selected
    ? state.legalMoves
    : state.hoverPreview
      ? state.hoverMoves
      : [];
  const illegalMoves = state.selected
    ? state.illegalMoves
    : state.hoverPreview
      ? state.hoverIllegalMoves
      : [];

  if (active) {
    const { row, col } = active;
    const x = colToX(col);
    const y = rowToY(row);
    if (x + state.squareSize > 0 && x < state.boardSize) {
      ctx.save();
      ctx.strokeStyle = isHover ? "rgba(44, 95, 108, 0.55)" : "rgba(44, 95, 108, 0.85)";
      ctx.lineWidth = state.squareSize * 0.06;
      if (isHover) {
        ctx.setLineDash([state.squareSize * 0.16, state.squareSize * 0.12]);
      } else if (state.legalMoves.length === 0 && state.illegalMoves.length > 0) {
        ctx.strokeStyle = "rgba(165, 47, 47, 0.8)";
        ctx.setLineDash([state.squareSize * 0.14, state.squareSize * 0.1]);
      }
      ctx.strokeRect(x + 2, y + 2, state.squareSize - 4, state.squareSize - 4);
      ctx.restore();
    }
  }

  const captureStroke = isHover ? "rgba(186, 54, 52, 0.55)" : "rgba(186, 54, 52, 0.85)";
  const captureFill = isHover ? "rgba(186, 54, 52, 0.18)" : "rgba(186, 54, 52, 0.28)";
  const quietFill = isHover ? "rgba(44, 95, 108, 0.25)" : "rgba(44, 95, 108, 0.4)";
  for (const move of legalMoves) {
    const [row, col] = move.to;
    const x = colToX(col);
    const y = rowToY(row);
    if (x + state.squareSize <= 0 || x >= state.boardSize) continue;
    const cx = x + state.squareSize / 2;
    const cy = y + state.squareSize / 2;
    const target = state.board.squares[row][col];
    const isCapture = !!target || move.isEnPassant;
    if (isCapture) {
      ctx.fillStyle = captureFill;
      ctx.beginPath();
      ctx.arc(cx, cy, state.squareSize * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = captureStroke;
      ctx.lineWidth = state.squareSize * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, state.squareSize * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = quietFill;
      ctx.beginPath();
      ctx.arc(cx, cy, state.squareSize * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (illegalMoves.length > 0) {
    ctx.save();
    ctx.strokeStyle = isHover ? "rgba(165, 47, 47, 0.45)" : "rgba(165, 47, 47, 0.7)";
    ctx.lineWidth = state.squareSize * 0.06;
    ctx.setLineDash([state.squareSize * 0.16, state.squareSize * 0.12]);
    for (const move of illegalMoves) {
      const [row, col] = move.to;
      const x = colToX(col);
      const y = rowToY(row);
      if (x + state.squareSize <= 0 || x >= state.boardSize) continue;
      const cx = x + state.squareSize / 2;
      const cy = y + state.squareSize / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, state.squareSize * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
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

let drawPending = false;

function requestDraw(): void {
  if (drawPending) return;
  drawPending = true;
  window.requestAnimationFrame(() => {
    drawPending = false;
    draw();
  });
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

function moveKey(move: Move): string {
  return `${move.from[0]}-${move.from[1]}-${move.to[0]}-${move.to[1]}`;
}

function cancelAiSearch(): void {
  aiRequestId += 1;
  pendingAiTurn = null;
  state.aiThinking = false;
  state.forceStepRequestId = null;
}

aiWorker.addEventListener("message", (event: MessageEvent<WorkerSearchResult>) => {
  const data = event.data;
  if (!data || data.type !== "result") return;

  const isStep = state.forceStepRequestId === data.id;
  if (data.id !== aiRequestId) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }
  if (pendingAiTurn && data.turn !== pendingAiTurn) {
    state.aiThinking = false;
    pendingAiTurn = null;
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }

  state.aiThinking = false;
  pendingAiTurn = null;

  if (!data.move) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }
  if (state.board.gameOver || state.pendingPromotion) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }
  if (state.mode === "aivai" && !state.aiAuto && !isStep) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }
  if (state.paused && !isStep) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }
  if (state.board.turn !== data.turn) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }

  const legalMoves = generateAllLegalMoves(state.board, state.board.turn);
  const matchedMove = legalMoves.find((move) => movesMatch(move, data.move!));
  if (!matchedMove) {
    if (isStep) {
      state.forceStepRequestId = null;
    }
    return;
  }

  if (isStep) {
    state.forceStepRequestId = null;
  }
  applyMove(state.board, matchedMove);
  recordRepetition(state.board);
  updateGameState(state.board);
  pushHistory(state.board);
  clearHover();
  resetSelection();
  scheduleNextTurn();
});

aiWorker.addEventListener("error", () => {
  state.aiThinking = false;
  pendingAiTurn = null;
  state.forceStepRequestId = null;
});

function simplifyMovesForUI(moves: Move[]): Move[] {
  const map = new Map<string, Move>();
  for (const move of moves) {
    const key = moveKey(move);
    if (!map.has(key)) {
      map.set(key, { ...move, promotion: undefined });
    }
  }
  return Array.from(map.values());
}

function getMoveSetsForPiece(board: Board, row: number, col: number): { legal: Move[]; illegal: Move[] } {
  const piece = board.squares[row][col];
  if (!piece) return { legal: [], illegal: [] };
  const pseudoMoves = generatePseudoMovesForPiece(board, row, col, piece);
  if (pseudoMoves.length === 0) return { legal: [], illegal: [] };

  const legal: Move[] = [];
  const illegal: Move[] = [];
  for (const move of pseudoMoves) {
    if (isMoveLegal(board, move, piece.color)) {
      legal.push(move);
    } else {
      illegal.push(move);
    }
  }

  const legalSimplified = simplifyMovesForUI(legal);
  const illegalSimplified = simplifyMovesForUI(illegal);
  const legalKeys = new Set(legalSimplified.map(moveKey));
  return {
    legal: legalSimplified,
    illegal: illegalSimplified.filter((move) => !legalKeys.has(moveKey(move))),
  };
}

function updateStatus(): void {
  if (!state.board.gameOver && state.mode === "aivai" && !state.aiAuto) {
    statusText.textContent = t("status_waiting");
    turnLabel.textContent = t("status_ai_standby");
    return;
  }
  if (state.board.gameOver) {
    if (state.board.winner === "draw") {
      if (getRepetitionCount(state.board) >= 3) {
        statusText.textContent = t("status_draw_repetition");
      } else if (state.board.halfMove >= 100) {
        statusText.textContent = t("status_draw_50");
      } else {
        statusText.textContent = t("status_draw");
      }
      turnLabel.textContent = t("status_game_over");
    } else if (state.board.winner === "w") {
      statusText.textContent = t("status_white_win");
      turnLabel.textContent = t("status_white_mate");
    } else {
      statusText.textContent = t("status_black_win");
      turnLabel.textContent = t("status_black_mate");
    }
    return;
  }

  const turnName = state.board.turn === "w" ? t("color_white") : t("color_black");
  const inCheck = isInCheck(state.board, state.board.turn);
  statusText.textContent = inCheck
    ? formatTemplate(t("status_check"), { color: turnName })
    : formatTemplate(t("status_move"), { color: turnName });
  turnLabel.textContent = inCheck
    ? formatTemplate(t("status_check"), { color: turnName })
    : formatTemplate(t("status_turn"), { color: turnName });
}

function updateButtons(): void {
  const aiVsAi = state.mode === "aivai";
  startBtn.disabled = !aiVsAi || state.aiAuto || state.board.gameOver;
  pauseBtn.disabled = !aiVsAi || !state.aiAuto || state.board.gameOver;
  pauseBtn.textContent = state.paused ? t("btn_resume") : t("btn_pause");
  const canStep = aiVsAi && !state.board.gameOver && (!state.aiAuto || state.paused);
  stepBtn.disabled = !canStep;
  undoBtn.disabled = boardHistory.length <= 1;
}

function updateDepthLabels(): void {
  aiDepthWhiteValue.textContent = formatTemplate(t("depth_value"), {
    value: state.aiDepthWhite.toString(),
  });
  aiDepthBlackValue.textContent = formatTemplate(t("depth_value"), {
    value: state.aiDepthBlack.toString(),
  });
}

function updateDelayLabel(): void {
  aiDelayValue.textContent = formatTemplate(t("delay_value"), {
    value: state.aiDelay.toString(),
  });
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
  state.illegalMoves = [];
}

function clearHover(): void {
  state.hovered = null;
  state.hoverMoves = [];
  state.hoverIllegalMoves = [];
}

function resetGame(): void {
  cancelAiSearch();
  state.board = initialBoard();
  state.baseCol = 0;
  state.snapBaseCol = 0;
  state.dragging = false;
  state.dragMoved = false;
  state.dragPointerId = null;
  state.forceStepRequestId = null;
  state.aiAuto = state.mode !== "aivai";
  state.paused = false;
  state.pendingPromotion = null;
  clearHover();
  resetRepetition(state.board);
  resetHistory(state.board);
  resetSelection();
  updateGameState(state.board);
  updateStatus();
  updateButtons();
  updateDepthControls();
  updateDepthLabels();
  requestDraw();
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
  state.flipBoard = mode === "aivh";
  resetGame();
}

function isHumanTurn(): boolean {
  const index = state.board.turn === "w" ? 0 : 1;
  return state.players[index] === "human";
}

function scheduleNextTurn(): void {
  updateStatus();
  updateButtons();
  requestDraw();
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
  if (force) {
    state.forceStepRequestId = requestId;
  }
  state.aiThinking = true;
  const delay = force ? 0 : state.aiDelay;
  window.setTimeout(() => {
    if (requestId !== aiRequestId) return;
    if (state.board.gameOver || state.pendingPromotion) {
      state.aiThinking = false;
      pendingAiTurn = null;
      return;
    }
    if (state.mode === "aivai" && !state.aiAuto && !force) {
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
  pushHistory(state.board);
  clearHover();
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
  pushHistory(state.board);
  clearHover();
  resetSelection();
  scheduleNextTurn();
}

function getBoardCoords(event: PointerEvent): { row: number; col: number } | null {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const colIndex = Math.floor(x / state.squareSize);
  const rowIndex = state.flipBoard ? Math.floor(y / state.squareSize) : 7 - Math.floor(y / state.squareSize);
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
    const { legal, illegal } = getMoveSetsForPiece(state.board, row, col);
    state.legalMoves = legal;
    state.illegalMoves = illegal;
    clearHover();
  } else {
    resetSelection();
  }
  requestDraw();
}

canvas.addEventListener("pointerdown", (event) => {
  if (state.pendingPromotion) return;
  if (event.isPrimary === false || event.button !== 0) return;
  if (state.dragging) return;
  if (state.hovered) {
    clearHover();
  }
  state.dragging = true;
  state.dragMoved = false;
  state.dragStartX = event.clientX;
  state.dragStartBaseCol = state.baseCol;
  state.dragPointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (state.dragging) {
    if (state.dragPointerId !== event.pointerId) return;
    let dx = event.clientX - state.dragStartX;
    if (!state.dragMoved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      state.dragMoved = true;
      state.dragStartX = event.clientX;
      state.dragStartBaseCol = state.baseCol;
      dx = 0;
    }
    state.baseCol = mod(state.dragStartBaseCol - dx / state.squareSize, 8);
    requestDraw();
    return;
  }
  if (!state.hoverPreview || state.pendingPromotion || state.selected) return;
  const coords = getBoardCoords(event);
  if (!coords) {
    if (state.hovered) {
      clearHover();
      requestDraw();
    }
    return;
  }
  const { row, col } = coords;
  const piece = state.board.squares[row][col];
  if (!piece) {
    if (state.hovered) {
      clearHover();
      requestDraw();
    }
    return;
  }
  if (state.hovered && state.hovered.row === row && state.hovered.col === col) return;
  const { legal, illegal } = getMoveSetsForPiece(state.board, row, col);
  state.hovered = { row, col };
  state.hoverMoves = legal;
  state.hoverIllegalMoves = illegal;
  requestDraw();
});

function endDrag(event: PointerEvent, allowClick: boolean): void {
  if (!state.dragging) return;
  if (state.dragPointerId !== event.pointerId) return;
  state.dragging = false;
  const wasDrag = state.dragMoved;
  state.dragMoved = false;
  state.dragPointerId = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  if (wasDrag) {
    state.baseCol = mod(Math.round(state.baseCol), 8);
    state.snapBaseCol = state.baseCol;
    requestDraw();
    return;
  }
  if (allowClick) {
    handleBoardClick(event);
  }
}

canvas.addEventListener("pointerup", (event) => endDrag(event, true));
canvas.addEventListener("pointercancel", (event) => endDrag(event, false));

canvas.addEventListener("pointerleave", () => {
  if (state.dragging || !state.hoverPreview) return;
  if (state.hovered) {
    clearHover();
    requestDraw();
  }
});

viewLeftBtn.addEventListener("click", () => {
  state.baseCol = mod(state.baseCol - 1, 8);
  state.snapBaseCol = mod(state.snapBaseCol - 1, 8);
  requestDraw();
});

viewRightBtn.addEventListener("click", () => {
  state.baseCol = mod(state.baseCol + 1, 8);
  state.snapBaseCol = mod(state.snapBaseCol + 1, 8);
  requestDraw();
});

viewCenterBtn.addEventListener("click", () => {
  state.baseCol = 0;
  state.snapBaseCol = 0;
  requestDraw();
});

flipBoardBtn.addEventListener("click", () => {
  state.flipBoard = !state.flipBoard;
  requestDraw();
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
  if (state.mode !== "aivai" || state.board.gameOver) return;
  if (state.aiAuto && !state.paused) return;
  triggerAiMove(true);
});

undoBtn.addEventListener("click", () => {
  let changed = false;
  if (state.aiThinking) {
    cancelAiSearch();
    changed = true;
  }
  if (state.pendingPromotion) {
    state.pendingPromotion = null;
    promotionOverlay.classList.remove("show");
    promotionOverlay.setAttribute("aria-hidden", "true");
    changed = true;
  }

  const whiteHuman = state.players[0] === "human";
  const blackHuman = state.players[1] === "human";
  let plies = 1;
  if (whiteHuman && blackHuman) {
    plies = 1;
  } else if (!whiteHuman && !blackHuman) {
    plies = 2;
  } else {
    const humanColor: Color = whiteHuman ? "w" : "b";
    plies = state.board.turn === humanColor ? 2 : 1;
  }

  const undone = undoPlies(plies);
  if (undone > 0) {
    updateGameState(state.board);
    changed = true;
  }

  if (!changed) return;
  clearHover();
  resetSelection();
  scheduleNextTurn();
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
    statusText.textContent = t("error_fen");
    return;
  }
  cancelAiSearch();
  state.board = loaded;
  state.baseCol = 0;
  state.snapBaseCol = 0;
  state.pendingPromotion = null;
  clearHover();
  resetRepetition(state.board);
  resetHistory(state.board);
  resetSelection();
  updateGameState(state.board);
  scheduleNextTurn();
});

aiDelaySlider.addEventListener("input", () => {
  state.aiDelay = Number(aiDelaySlider.value);
  updateDelayLabel();
});

aiDepthWhite.addEventListener("input", () => {
  state.aiDepthWhite = Number(aiDepthWhite.value);
  updateDepthLabels();
});

aiDepthBlack.addEventListener("input", () => {
  state.aiDepthBlack = Number(aiDepthBlack.value);
  updateDepthLabels();
});

hoverPreviewToggle.addEventListener("change", () => {
  state.hoverPreview = hoverPreviewToggle.checked;
  if (!state.hoverPreview) {
    clearHover();
  }
  requestDraw();
});

languageSelect.addEventListener("change", () => {
  const value = languageSelect.value as Language;
  if (value === "zh" || value === "en") {
    setLanguage(value);
  }
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

setLanguage(state.language, false);
updateDepthControls();
hoverPreviewToggle.checked = state.hoverPreview;
resetRepetition(state.board);
resetHistory(state.board);
updateGameState(state.board);
resizeCanvas();
scheduleNextTurn();
