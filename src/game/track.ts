import { Vec2, Track, CheckpointCircle } from './types';

// Circuit control points — catmull-rom spline interpolated
// Designed as a flowing circuit with main straight, two sweeping turns,
// a chicane on the right, and a hairpin at the bottom.
const CTRL: Vec2[] = [
  { x: 750,  y: 1380 }, //  0: start / finish
  { x: 750,  y: 1100 }, //  1: main straight
  { x: 750,  y: 780  }, //  2: main straight
  { x: 750,  y: 520  }, //  3: approach turn 1
  { x: 780,  y: 300  }, //  4: turn 1 entry
  { x: 1000, y: 130  }, //  5: turn 1 apex
  { x: 1300, y: 80   }, //  6: top straight
  { x: 1700, y: 80   }, //  7: top straight
  { x: 2000, y: 160  }, //  8: turn 2 entry
  { x: 2180, y: 400  }, //  9: turn 2 apex
  { x: 2180, y: 700  }, // 10: right straight
  { x: 2080, y: 970  }, // 11: chicane left
  { x: 2200, y: 1150 }, // 12: chicane right
  { x: 2160, y: 1430 }, // 13: bottom-right
  { x: 1950, y: 1610 }, // 14: hairpin entry
  { x: 1650, y: 1680 }, // 15: hairpin apex
  { x: 1300, y: 1650 }, // 16: bottom straight
  { x: 980,  y: 1580 }, // 17: bottom straight
  { x: 840,  y: 1500 }, // 18: approach start
];

const TRACK_WIDTH = 155;
const SPLINE_RES  = 20; // smoothing points per segment

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2*p1.x + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5 * (2*p1.y + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
  };
}

function generateCenterLine(controls: Vec2[]): Vec2[] {
  const n = controls.length;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = controls[(i - 1 + n) % n];
    const p1 = controls[i];
    const p2 = controls[(i + 1) % n];
    const p3 = controls[(i + 2) % n];
    for (let j = 0; j < SPLINE_RES; j++) {
      pts.push(catmullRom(p0, p1, p2, p3, j / SPLINE_RES));
    }
  }
  return pts;
}

export function createTrack(): Track {
  const centerPoints = generateCenterLine(CTRL);
  const n = CTRL.length;

  // Checkpoints evenly spread: index 0 = finish, 1-3 = intermediate
  const checkpoints: CheckpointCircle[] = [
    { ...CTRL[0],                          radius: TRACK_WIDTH * 0.72 }, // finish
    { ...CTRL[Math.round(n * 0.26)],       radius: TRACK_WIDTH * 0.72 }, // ~top area
    { ...CTRL[Math.round(n * 0.55)],       radius: TRACK_WIDTH * 0.72 }, // ~right side
    { ...CTRL[Math.round(n * 0.82)],       radius: TRACK_WIDTH * 0.72 }, // ~bottom
  ];

  // Starting grid: 2×2 behind the finish line (cars face roughly north / slightly)
  const startPositions: Vec2[] = [
    { x: 715, y: 1460 },
    { x: 790, y: 1490 },
    { x: 715, y: 1530 },
    { x: 790, y: 1560 },
  ];

  return {
    centerPoints,
    waypoints: CTRL,
    trackWidth: TRACK_WIDTH,
    checkpoints,
    startPositions,
    startRotation: -2, // very slightly right of north so cars don't overlap on start
  };
}

// ── Geometry helpers ──────────────────────────────────────────

function distToSegSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 < 1e-6) return (px-ax)**2 + (py-ay)**2;
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
  return (px - ax - t*dx)**2 + (py - ay - t*dy)**2;
}

export function isOnTrack(px: number, py: number, track: Track): boolean {
  const hw2 = (track.trackWidth / 2) ** 2;
  const pts = track.centerPoints;
  const n   = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (distToSegSq(px, py, a.x, a.y, b.x, b.y) < hw2) return true;
  }
  return false;
}

// Compute per-point outward normals for the closed center line
export function computeNormals(pts: Vec2[]): Vec2[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    return { x: -dy / len, y: dx / len };
  });
}
