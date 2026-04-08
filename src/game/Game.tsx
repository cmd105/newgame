import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { Car, Track, GamePhase, CarType, Vec2 } from './types';
import { createTrack, isOnTrack, computeNormals } from './track';
import { updateCar } from './physics';
import { updateAI } from './ai';

// ─── Constants ────────────────────────────────────────────────────────────────
const LAPS_REQUIRED = 2;
const FPS           = 60;
const CAR_W         = 24;
const CAR_H         = 42;

// Canvas logical size (CSS scales it to fill the screen)
const CW = 800;
const CH = 600;

// ─── Car type presets (ported from sportscar_init, racingcar_init, etc.) ──────
const CAR_PRESETS: Record<CarType, Omit<Car, 'id'|'x'|'y'|'rotation'|'vx'|'vy'|'angularVelocity'|'wheelAngle'|'lap'|'nextCheckpoint'|'racePosition'|'finished'|'finishTime'|'isAI'|'aiWaypointIndex'|'color'|'name'|'width'|'height'>> = {
  sportscar: {
    maxSpeed: 5.2, maxSpeedRev: 2.8,
    engineAcc: 0.115, engineBrk: 0.18, engineRev: 0.075,
    maxWheelAngle: 30, wheelAngleVelocity: 3,
    torqueAcc: 0.42, torqueRev: 0.90, torqueDamp: 0.12,
    drift: 1.0,
  },
  racingcar: {
    maxSpeed: 6.8, maxSpeedRev: 2.8,
    engineAcc: 0.17, engineBrk: 0.22, engineRev: 0.09,
    maxWheelAngle: 25, wheelAngleVelocity: 9,
    torqueAcc: 0.38, torqueRev: 1.1, torqueDamp: 0.10,
    drift: 1.0,
  },
  gokart: {
    maxSpeed: 4.4, maxSpeedRev: 2.4,
    engineAcc: 0.10, engineBrk: 0.15, engineRev: 0.06,
    maxWheelAngle: 36, wheelAngleVelocity: 4,
    torqueAcc: 0.50, torqueRev: 0.80, torqueDamp: 0.14,
    drift: 1.0,
  },
};

const AI_COLORS = ['#3d9eff', '#44e86c', '#e86cdf'];
const AI_NAMES  = ['Blaze', 'Nova', 'Rex'];

// ─── Factory ──────────────────────────────────────────────────────────────────
function makeCar(
  id: number,
  type: CarType | null,
  pos: Vec2,
  rotation: number,
  isAI: boolean,
): Car {
  const carType: CarType = type ?? 'sportscar';
  const preset = CAR_PRESETS[carType];
  const speedVar = isAI ? 0.80 + Math.random() * 0.38 : 1;
  return {
    id,
    x: pos.x, y: pos.y,
    rotation,
    vx: 0, vy: 0,
    angularVelocity: 0,
    wheelAngle: 0,
    ...preset,
    maxSpeed: preset.maxSpeed * speedVar,
    engineAcc: preset.engineAcc * speedVar,
    lap: 0,
    nextCheckpoint: 1, // must pass CPs 1→2→3→0 before lap counts
    racePosition: id + 1,
    finished: false,
    finishTime: 0,
    isAI,
    aiWaypointIndex: isAI ? (id * 3) % 19 : 0,
    color: isAI ? AI_COLORS[id - 1] : '#ff4040',
    name: isAI ? AI_NAMES[id - 1] : 'YOU',
    width: CAR_W,
    height: CAR_H,
  };
}

// ─── Lap / checkpoint tracking ────────────────────────────────────────────────
function updateLapTracking(
  car: Car,
  track: Track,
  frame: number,
  raceStart: number,
): void {
  const cp   = track.checkpoints[car.nextCheckpoint];
  const dist = Math.sqrt((car.x - cp.x) ** 2 + (car.y - cp.y) ** 2);
  if (dist >= cp.radius) return;

  if (car.nextCheckpoint === 0) {
    // Crossed finish line after all intermediate checkpoints → new lap
    car.lap++;
    car.nextCheckpoint = 1;
    if (car.lap >= LAPS_REQUIRED && !car.finished) {
      car.finished  = true;
      car.finishTime = frame - raceStart;
    }
  } else {
    car.nextCheckpoint = (car.nextCheckpoint + 1) % track.checkpoints.length;
  }
}

function updatePositions(cars: Car[]): void {
  const n = cars[0]?.nextCheckpoint !== undefined ? track_checkpointCount(cars) : 4;
  const scored = cars.map(c => ({
    car: c,
    score: c.finished
      ? 1e9 + (1 / (c.finishTime || 1))
      : c.lap * n + ((c.nextCheckpoint - 1 + n) % n),
  }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach(({ car }, i) => { car.racePosition = i + 1; });
}
function track_checkpointCount(cars: Car[]) {
  // fixed: 4 checkpoints (indices 0-3)
  void cars;
  return 4;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
let cachedNormals: Vec2[] | null = null;
let cachedCenterPts: Vec2[] | null = null;

function getOrComputeNormals(track: Track): Vec2[] {
  if (cachedNormals && cachedCenterPts === track.centerPoints) return cachedNormals;
  cachedNormals   = computeNormals(track.centerPoints);
  cachedCenterPts = track.centerPoints;
  return cachedNormals;
}

function drawTrack(ctx: CanvasRenderingContext2D, track: Track): void {
  const pts    = track.centerPoints;
  const n      = pts.length;
  const norms  = getOrComputeNormals(track);
  const hw     = track.trackWidth / 2;

  // ── Road surface (thick stroke) ──
  ctx.beginPath();
  ctx.strokeStyle = '#4a4a52';
  ctx.lineWidth   = track.trackWidth;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();

  // ── Outer & inner edge lines ──
  for (const sign of [1, -1]) {
    ctx.beginPath();
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'butt';
    ctx.moveTo(pts[0].x + norms[0].x * hw * sign, pts[0].y + norms[0].y * hw * sign);
    for (let i = 1; i < n; i++) {
      ctx.lineTo(pts[i].x + norms[i].x * hw * sign, pts[i].y + norms[i].y * hw * sign);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // ── Dashed centre line ──
  ctx.beginPath();
  ctx.strokeStyle = '#ffe04a88';
  ctx.lineWidth   = 2;
  ctx.setLineDash([22, 22]);
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Start / finish checkerboard ──
  drawFinishLine(ctx, pts[0], norms[0], hw);
}

function drawFinishLine(
  ctx: CanvasRenderingContext2D,
  pt: Vec2,
  norm: Vec2,
  hw: number,
): void {
  const squares = 12;
  const sqSize  = (hw * 2) / squares;
  const tang    = { x: norm.y, y: -norm.x }; // 90° rotation of normal

  for (let i = 0; i < squares; i++) {
    const off = (i - squares / 2 + 0.5) * sqSize;
    const cx  = pt.x + norm.x * off;
    const cy  = pt.y + norm.y * off;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(tang.y, tang.x));
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#000000';
    ctx.fillRect(-sqSize * 0.5, -sqSize * 1.5, sqSize, sqSize * 3);
    ctx.restore();
  }
}

function drawCar(ctx: CanvasRenderingContext2D, car: Car): void {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.rotation * Math.PI / 180);

  const w = car.width;
  const h = car.height;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w, h);

  // Body
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 3);
  ctx.fill();

  // Windshield
  ctx.fillStyle = 'rgba(180,230,255,0.82)';
  ctx.fillRect(-w / 2 + 4, -h / 2 + 7, w - 8, h * 0.26);

  // Rear window
  ctx.fillStyle = 'rgba(140,200,240,0.55)';
  ctx.fillRect(-w / 2 + 4, h / 2 - 13, w - 8, 8);

  // Wheels — rear (static)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-w / 2 - 5, h / 2 - 17, 6, 12);
  ctx.fillRect( w / 2 - 1, h / 2 - 17, 6, 12);

  // Wheels — front (steered)
  for (const xOff of [-w / 2 - 5, w / 2 - 1]) {
    ctx.save();
    ctx.translate(xOff + 3, -h / 2 + 11);
    ctx.rotate(car.wheelAngle * Math.PI / 180);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-3, -6, 6, 12);
    ctx.restore();
  }

  ctx.restore();
}

function renderFrame(
  ctx:    CanvasRenderingContext2D,
  cars:   Car[],
  track:  Track,
  camX:   number,
  camY:   number,
): void {
  ctx.save();
  ctx.translate(CW / 2 - camX, CH / 2 - camY);

  // Grass background (draw large enough around camera)
  const pad = 1200;
  ctx.fillStyle = '#2d7a3a';
  ctx.fillRect(camX - CW / 2 - pad, camY - CH / 2 - pad, CW + pad * 2, CH + pad * 2);

  drawTrack(ctx, track);

  for (const car of cars) drawCar(ctx, car);

  // Car name labels
  ctx.font      = 'bold 11px Arial';
  ctx.textAlign = 'center';
  for (const car of cars) {
    ctx.fillStyle = '#ffffffdd';
    ctx.fillText(car.name, car.x, car.y - CAR_H / 2 - 7);
  }

  ctx.restore();
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function formatTime(frames: number): string {
  const total  = frames / FPS;
  const m      = Math.floor(total / 60);
  const s      = Math.floor(total % 60);
  const cs     = Math.floor((total - Math.floor(total)) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function ordinal(n: number): string {
  return ['1st','2nd','3rd','4th'][n - 1] ?? `${n}th`;
}

// ─── Game component ───────────────────────────────────────────────────────────
const CAR_LABEL: Record<CarType, string> = {
  sportscar: 'Sports Car',
  racingcar: 'Racing Car',
  gokart:    'Go-Kart',
};

export default function Game() {
  // React UI state
  const [phase,       setPhase]       = useState<GamePhase>('menu');
  const [countdown,   setCountdown]   = useState(3);
  const [lapDisp,     setLapDisp]     = useState(1);
  const [posDisp,     setPosDisp]     = useState(1);
  const [timeDisp,    setTimeDisp]    = useState(0);
  const [finalTime,   setFinalTime]   = useState(0);
  const [selectedCar, setSelectedCar] = useState<CarType>('sportscar');
  const [topCars,     setTopCars]     = useState<{name:string;time:number}[]>([]);

  // Mutable game state (not triggering re-renders)
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const carsRef     = useRef<Car[]>([]);
  const trackRef    = useRef<Track | null>(null);
  const phaseRef    = useRef<GamePhase>('menu');
  const frameRef    = useRef(0);
  const raceStartRef= useRef(0);
  const cdRef       = useRef(0); // countdown frames remaining
  const rafRef      = useRef(0);

  // Input
  const keyRef   = useRef({ up:false, down:false, left:false, right:false });
  const touchRef = useRef({ left:false, right:false, accel:false, brake:false });

  // ── Keyboard ──────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = keyRef.current;
      if (e.key==='ArrowUp'   ||e.key==='w'||e.key==='W') k.up    = true;
      if (e.key==='ArrowDown' ||e.key==='s'||e.key==='S') k.down  = true;
      if (e.key==='ArrowLeft' ||e.key==='a'||e.key==='A') k.left  = true;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') k.right = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const k = keyRef.current;
      if (e.key==='ArrowUp'   ||e.key==='w'||e.key==='W') k.up    = false;
      if (e.key==='ArrowDown' ||e.key==='s'||e.key==='S') k.down  = false;
      if (e.key==='ArrowLeft' ||e.key==='a'||e.key==='A') k.left  = false;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') k.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup',   up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // ── Canvas resize ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = Math.min(window.innerWidth / CW, window.innerHeight / CH);
      canvas.style.width  = `${CW * ratio}px`;
      canvas.style.height = `${CH * ratio}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ── Start race ─────────────────────────────────────────────
  const startRace = useCallback((carType: CarType) => {
    const track = createTrack();
    trackRef.current = track;
    cachedNormals     = null; // reset cache for new track

    const sp = track.startPositions;
    carsRef.current = [
      makeCar(0, carType, sp[0], track.startRotation, false),
      makeCar(1, null,    sp[1], track.startRotation, true),
      makeCar(2, null,    sp[2], track.startRotation, true),
      makeCar(3, null,    sp[3], track.startRotation, true),
    ];

    frameRef.current   = 0;
    raceStartRef.current = 0;
    cdRef.current      = FPS * 3 + 1; // 3-second countdown
    phaseRef.current   = 'countdown';

    setPhase('countdown');
    setCountdown(3);
    setLapDisp(1);
    setPosDisp(1);
    setTimeDisp(0);
    setTopCars([]);
  }, []);

  // ── Game loop ─────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'menu') { cancelAnimationFrame(rafRef.current); return; }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const safeCtx: CanvasRenderingContext2D = ctx;

    let lastT = performance.now();

    function tick(now: number) {
      const ctx   = safeCtx;
      const rawDt = (now - lastT) / (1000 / FPS);
      const dt    = Math.min(rawDt, 3.0);
      lastT = now;
      frameRef.current++;

      const track = trackRef.current!;
      const cars  = carsRef.current;
      const ph    = phaseRef.current;

      // ── Countdown phase ──
      if (ph === 'countdown') {
        cdRef.current -= dt;
        const secs = Math.ceil(cdRef.current / FPS);
        setCountdown(secs > 0 ? secs : 0);
        if (cdRef.current <= 0) {
          phaseRef.current     = 'racing';
          raceStartRef.current = frameRef.current;
          setPhase('racing');
        }
      }

      // ── Racing phase ──
      if (ph === 'racing') {
        const inp   = keyRef.current;
        const tch   = touchRef.current;
        const player = cars[0];

        const acc   = (inp.up   || tch.accel) ? 1 : (inp.down  || tch.brake) ? -1 : 0;
        const steer = (inp.left || tch.left)  ? -player.maxWheelAngle
                    : (inp.right|| tch.right) ?  player.maxWheelAngle : 0;

        // Player physics
        updateCar(player, acc, steer, dt);

        // Off-track grass drag
        if (!isOnTrack(player.x, player.y, track)) {
          player.vx *= Math.pow(0.90, dt);
          player.vy *= Math.pow(0.90, dt);
        }

        // AI updates
        for (let i = 1; i < cars.length; i++) {
          updateAI(cars[i], track, dt);
          if (!isOnTrack(cars[i].x, cars[i].y, track)) {
            cars[i].vx *= Math.pow(0.90, dt);
            cars[i].vy *= Math.pow(0.90, dt);
          }
        }

        // Lap tracking
        for (const car of cars) {
          updateLapTracking(car, track, frameRef.current, raceStartRef.current);
        }

        // Race positions
        updatePositions(cars);

        // Update React UI (every 4 frames to reduce overhead)
        if (frameRef.current % 4 === 0) {
          setLapDisp(Math.min(player.lap + 1, LAPS_REQUIRED));
          setPosDisp(player.racePosition);
          setTimeDisp(frameRef.current - raceStartRef.current);
        }

        // Check player finished
        if (player.finished && phaseRef.current === 'racing') {
          phaseRef.current = 'finished';
          setPhase('finished');
          setFinalTime(player.finishTime);
          // Build top-3 list
          const finished = [...cars]
            .filter(c => c.finished)
            .sort((a, b) => a.finishTime - b.finishTime)
            .slice(0, 4);
          setTopCars(finished.map(c => ({ name: c.name, time: c.finishTime })));
        }
      }

      // ── Render ──
      const cam = cars[0];
      ctx.clearRect(0, 0, CW, CH);
      renderFrame(ctx, cars, track, cam.x, cam.y);

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  // ── Touch button helpers ──────────────────────────────────
  const tBtn = (key: keyof typeof touchRef.current, val: boolean) =>
    () => { touchRef.current[key] = val; };

  // ─────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      {/* Game canvas */}
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        style={styles.canvas}
      />

      {/* ── Menu ── */}
      {phase === 'menu' && (
        <div style={styles.overlay}>
          <div style={styles.panel}>
            <h1 style={styles.title}>DRIFT RACER</h1>
            <p style={styles.subtitle}>Select your car</p>
            <div style={styles.carBtns}>
              {(Object.keys(CAR_LABEL) as CarType[]).map(ct => (
                <button
                  key={ct}
                  style={{ ...styles.carBtn, ...(selectedCar === ct ? styles.carBtnActive : {}) }}
                  onClick={() => setSelectedCar(ct)}
                >
                  {CAR_LABEL[ct]}
                </button>
              ))}
            </div>
            <button style={styles.startBtn} onClick={() => startRace(selectedCar)}>
              START RACE
            </button>
            <p style={styles.hint}>Arrow keys / WASD — or use on-screen controls</p>
          </div>
        </div>
      )}

      {/* ── Countdown ── */}
      {phase === 'countdown' && (
        <div style={{ ...styles.overlay, pointerEvents: 'none' }}>
          <div style={styles.countdownNum}>
            {countdown > 0 ? countdown : 'GO!'}
          </div>
        </div>
      )}

      {/* ── Racing HUD ── */}
      {phase === 'racing' && (
        <div style={styles.hud} >
          <div style={styles.hudBox}>
            <span style={styles.hudLabel}>LAP</span>
            <span style={styles.hudVal}>{lapDisp} / {LAPS_REQUIRED}</span>
          </div>
          <div style={styles.hudBox}>
            <span style={styles.hudLabel}>POS</span>
            <span style={styles.hudVal}>{ordinal(posDisp)}</span>
          </div>
          <div style={styles.hudBox}>
            <span style={styles.hudLabel}>TIME</span>
            <span style={styles.hudVal}>{formatTime(timeDisp)}</span>
          </div>
        </div>
      )}

      {/* ── Finished ── */}
      {phase === 'finished' && (
        <div style={styles.overlay}>
          <div style={styles.panel}>
            <h2 style={styles.title}>RACE FINISHED</h2>
            <p style={styles.finishTime}>Your time: {formatTime(finalTime)}</p>
            {topCars.length > 0 && (
              <div style={styles.results}>
                {topCars.map((c, i) => (
                  <div key={i} style={styles.resultRow}>
                    <span style={styles.resultPos}>{ordinal(i + 1)}</span>
                    <span style={styles.resultName}>{c.name}</span>
                    <span style={styles.resultTime}>{formatTime(c.time)}</span>
                  </div>
                ))}
              </div>
            )}
            <button style={styles.startBtn} onClick={() => setPhase('menu')}>
              PLAY AGAIN
            </button>
          </div>
        </div>
      )}

      {/* ── Touch controls (always visible during racing / countdown) ── */}
      {(phase === 'racing' || phase === 'countdown') && (
        <div style={styles.touchControls}>
          {/* Left side: steering */}
          <div style={styles.dpad}>
            <button
              style={styles.dpadBtn}
              onTouchStart={tBtn('left',  true)}  onTouchEnd={tBtn('left',  false)}
              onMouseDown ={tBtn('left',  true)}  onMouseUp  ={tBtn('left',  false)}
              onMouseLeave={tBtn('left',  false)}
            >◀</button>
            <button
              style={styles.dpadBtn}
              onTouchStart={tBtn('right', true)}  onTouchEnd={tBtn('right', false)}
              onMouseDown ={tBtn('right', true)}  onMouseUp  ={tBtn('right', false)}
              onMouseLeave={tBtn('right', false)}
            >▶</button>
          </div>

          {/* Right side: accel / brake */}
          <div style={styles.actionBtns}>
            <button
              style={{ ...styles.actionBtn, background: '#28a745cc' }}
              onTouchStart={tBtn('accel', true)}  onTouchEnd={tBtn('accel', false)}
              onMouseDown ={tBtn('accel', true)}  onMouseUp  ={tBtn('accel', false)}
              onMouseLeave={tBtn('accel', false)}
            >GAS</button>
            <button
              style={{ ...styles.actionBtn, background: '#dc3545cc' }}
              onTouchStart={tBtn('brake', true)}  onTouchEnd={tBtn('brake', false)}
              onMouseDown ={tBtn('brake', true)}  onMouseUp  ={tBtn('brake', false)}
              onMouseLeave={tBtn('brake', false)}
            >BRK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: {
    position:    'relative',
    width:       '100vw',
    height:      '100vh',
    display:     'flex',
    alignItems:  'center',
    justifyContent: 'center',
    background:  '#111',
    overflow:    'hidden',
  },
  canvas: {
    display:    'block',
    imageRendering: 'pixelated',
  },
  overlay: {
    position:       'absolute',
    inset:          0,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    background:     'rgba(0,0,0,0.65)',
    zIndex:         10,
  },
  panel: {
    background:   '#1a1a2e',
    border:       '2px solid #e94560',
    borderRadius: 12,
    padding:      '32px 40px',
    display:      'flex',
    flexDirection:'column',
    alignItems:   'center',
    gap:          16,
    maxWidth:     380,
    width:        '90vw',
  },
  title: {
    color:          '#e94560',
    fontSize:       32,
    fontWeight:     900,
    letterSpacing:  4,
    textTransform:  'uppercase',
    margin:         0,
  },
  subtitle: {
    color:    '#aaa',
    fontSize: 14,
    margin:   0,
  },
  carBtns: {
    display:        'flex',
    gap:            10,
    flexWrap:       'wrap',
    justifyContent: 'center',
  },
  carBtn: {
    background:   '#0f3460',
    color:        '#fff',
    border:       '2px solid #16213e',
    borderRadius: 6,
    padding:      '8px 14px',
    cursor:       'pointer',
    fontSize:     13,
    fontWeight:   600,
    transition:   'all 0.15s',
  },
  carBtnActive: {
    background:  '#e94560',
    border:      '2px solid #ff6b81',
  },
  startBtn: {
    background:   '#e94560',
    color:        '#fff',
    border:       'none',
    borderRadius: 8,
    padding:      '12px 32px',
    fontSize:     16,
    fontWeight:   900,
    cursor:       'pointer',
    letterSpacing:2,
    marginTop:    6,
  },
  hint: {
    color:    '#666',
    fontSize: 11,
    textAlign:'center',
  },
  countdownNum: {
    fontSize:    120,
    fontWeight:  900,
    color:       '#ffe066',
    textShadow:  '0 0 30px #ffe06688',
    letterSpacing: 8,
    animation:   'none',
  },
  hud: {
    position:       'absolute',
    top:            10,
    left:           '50%',
    transform:      'translateX(-50%)',
    display:        'flex',
    gap:            12,
    zIndex:         5,
    pointerEvents:  'none',
  },
  hudBox: {
    background:   'rgba(0,0,0,0.6)',
    border:       '1px solid #ffffff33',
    borderRadius: 6,
    padding:      '4px 12px',
    display:      'flex',
    flexDirection:'column',
    alignItems:   'center',
    minWidth:     64,
  },
  hudLabel: { color:'#aaa', fontSize:10, letterSpacing:1, textTransform:'uppercase' },
  hudVal:   { color:'#fff', fontSize:18, fontWeight:700 },
  finishTime: {
    color:    '#ffe066',
    fontSize: 22,
    fontWeight:700,
  },
  results: {
    width:   '100%',
    display: 'flex',
    flexDirection: 'column',
    gap:     6,
  },
  resultRow: {
    display:         'flex',
    justifyContent:  'space-between',
    alignItems:      'center',
    background:      '#0f3460',
    borderRadius:    6,
    padding:         '6px 12px',
  },
  resultPos:  { color:'#ffe066', fontSize:14, fontWeight:700, minWidth:32 },
  resultName: { color:'#fff',    fontSize:14, fontWeight:600, flex:1, textAlign:'center' },
  resultTime: { color:'#aaa',    fontSize:13, minWidth:60, textAlign:'right' },
  touchControls: {
    position:       'absolute',
    bottom:         12,
    left:           0,
    right:          0,
    display:        'flex',
    justifyContent: 'space-between',
    padding:        '0 16px',
    zIndex:         5,
    pointerEvents:  'none',
  },
  dpad: {
    display:      'flex',
    gap:          10,
    pointerEvents:'all',
  },
  dpadBtn: {
    width:        68,
    height:       68,
    background:   'rgba(255,255,255,0.15)',
    border:       '2px solid rgba(255,255,255,0.3)',
    borderRadius: 12,
    color:        '#fff',
    fontSize:     26,
    cursor:       'pointer',
    display:      'flex',
    alignItems:   'center',
    justifyContent:'center',
    WebkitUserSelect:'none',
    touchAction:  'none',
  },
  actionBtns: {
    display:      'flex',
    flexDirection:'column',
    gap:          8,
    pointerEvents:'all',
  },
  actionBtn: {
    width:        80,
    height:       52,
    border:       'none',
    borderRadius: 10,
    color:        '#fff',
    fontSize:     15,
    fontWeight:   900,
    cursor:       'pointer',
    letterSpacing:1,
    touchAction:  'none',
  },
};
