// Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction L or M, versions 1-40,
// automatic mask choice. It follows the public reference algorithm (Project Nayuki, MIT) and runs
// entirely in the browser: no dependency, no network, no CDN.

export type QrLevel = 'L' | 'M'
export type QrMatrix = { size: number; dark: (x: number, y: number) => boolean }

const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
}
const BLOCKS: Record<QrLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
}
const FORMAT_BITS: Record<QrLevel, number> = { L: 1, M: 0 }

function rawModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (ver >= 7) result -= 36
  }
  return result
}
const dataCodewords = (ver: number, level: QrLevel) =>
  Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[level][ver] * BLOCKS[level][ver]

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const count = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = ver * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

// Reed-Solomon over GF(2^8) with polynomial 0x11D.
function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor) })
  }
  return result
}

function interleave(data: number[], ver: number, level: QrLevel): number[] {
  const numBlocks = BLOCKS[level][ver], blockEcc = ECC_PER_BLOCK[level][ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = numBlocks - (raw % numBlocks), shortLen = Math.floor(raw / numBlocks)
  const divisor = rsDivisor(blockEcc)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - blockEcc + (i < shortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < shortBlocks) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEcc || j >= shortBlocks) result.push(block[i])
    })
  }
  return result
}

class Grid {
  readonly size: number
  readonly modules: boolean[][]
  readonly fn: boolean[][]
  constructor(size: number) {
    this.size = size
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  }
  setFn(x: number, y: number, dark: boolean) { this.modules[y][x] = dark; this.fn[y][x] = true }
}

function drawFunctionPatterns(g: Grid, ver: number) {
  const size = g.size
  for (let i = 0; i < size; i++) { g.setFn(6, i, i % 2 === 0); g.setFn(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) g.setFn(x, y, dist !== 2 && dist !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const align = alignmentPositions(ver), n = align.length
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      g.setFn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  drawFormat(g, 'M', 0) // Reserve; overwritten after masking.
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3)
      g.setFn(a, b, dark); g.setFn(b, a, dark)
    }
  }
}

function drawFormat(g: Grid, level: QrLevel, mask: number) {
  const data = (FORMAT_BITS[level] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) !== 0
  const size = g.size
  for (let i = 0; i <= 5; i++) g.setFn(8, i, bit(i))
  g.setFn(8, 7, bit(6)); g.setFn(8, 8, bit(7)); g.setFn(7, 8, bit(8))
  for (let i = 9; i < 15; i++) g.setFn(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) g.setFn(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) g.setFn(8, size - 15 + i, bit(i))
  g.setFn(8, size - 8, true)
}

function drawCodewords(g: Grid, codewords: number[]) {
  const size = g.size
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert
      if (!g.fn[y][x] && i < codewords.length * 8) {
        g.modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0
        i++
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]
function applyMask(g: Grid, mask: number) {
  const test = MASKS[mask]
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++)
    if (!g.fn[y][x] && test(x, y)) g.modules[y][x] = !g.modules[y][x]
}

function penalty(g: Grid): number {
  const size = g.size, m = g.modules
  let result = 0
  const runPenalty = (line: boolean[]) => {
    let score = 0, run = 1
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++
      else { if (run >= 5) score += run - 2; run = 1 }
    }
    const pattern = [true, false, true, true, true, false, true]
    for (let i = 0; i + 7 <= line.length; i++) {
      if (!pattern.every((p, k) => line[i + k] === p)) continue
      const before = i >= 4 && line.slice(i - 4, i).every(v => !v)
      const after = i + 11 <= line.length && line.slice(i + 7, i + 11).every(v => !v)
      if (before || after || i < 4 || i + 11 > line.length) score += 40
    }
    return score
  }
  for (let y = 0; y < size; y++) result += runPenalty(m[y])
  for (let x = 0; x < size; x++) result += runPenalty(m.map(row => row[x]))
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x]
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3
  }
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const total = size * size
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return result
}

/** Encodes text as a QR code. Throws when the text is too long for version 40. */
export function encodeQr(text: string, level: QrLevel = 'M', forcedMask?: number): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 1
  for (; ver <= 40; ver++) {
    const countBits = ver <= 9 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(ver, level) * 8) break
  }
  if (ver > 40) throw new Error('Text too long for a QR code')
  const capacity = dataCodewords(ver, level) * 8
  const bits: number[] = []
  const push = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  push(0b0100, 4); push(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  const size = ver * 4 + 17
  const base = new Grid(size)
  drawFunctionPatterns(base, ver)
  drawCodewords(base, interleave(data, ver, level))
  let best: Grid | null = null, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    if (forcedMask !== undefined && mask !== forcedMask) continue
    const g = new Grid(size)
    for (let y = 0; y < size; y++) { g.modules[y] = base.modules[y].slice(); g.fn[y] = base.fn[y].slice() }
    applyMask(g, mask)
    drawFormat(g, level, mask)
    const score = forcedMask === undefined ? penalty(g) : 0
    if (score < bestScore) { best = g; bestScore = score }
  }
  const result = best as Grid
  return { size, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && result.modules[y][x] }
}

/** One SVG path ("M x y h1 v1 h-1 z" per dark module) for a 0-based module grid. */
export function qrPath(matrix: QrMatrix, margin = 4): string {
  let d = ''
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.dark(x, y)) continue
      let run = 1
      while (matrix.dark(x + run, y)) run++
      d += `M${x + margin} ${y + margin}h${run}v1h-${run}z`
      x += run - 1
    }
  }
  return d
}
