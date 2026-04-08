export interface Vec2 {
  x: number;
  y: number;
}

export interface Car {
  id: number;
  x: number;
  y: number;
  rotation: number;       // degrees, 0 = north (up), clockwise positive
  vx: number;
  vy: number;
  angularVelocity: number;
  wheelAngle: number;     // current front-wheel steering angle (degrees)

  // Physics params (px/frame units)
  maxSpeed: number;
  maxSpeedRev: number;
  engineAcc: number;
  engineBrk: number;
  engineRev: number;
  maxWheelAngle: number;
  wheelAngleVelocity: number;
  torqueAcc: number;
  torqueRev: number;
  torqueDamp: number;
  drift: number;          // 1 = full grip, 0 = no grip (pure drift)

  // Race state
  lap: number;
  nextCheckpoint: number; // 0 = finish line, 1-3 = intermediate checkpoints
  racePosition: number;
  finished: boolean;
  finishTime: number;     // frames

  // Control
  isAI: boolean;
  aiWaypointIndex: number;

  // Visuals
  color: string;
  name: string;
  width: number;
  height: number;
}

export interface CheckpointCircle {
  x: number;
  y: number;
  radius: number;
}

export interface Track {
  centerPoints: Vec2[];
  waypoints: Vec2[];        // AI navigation points
  trackWidth: number;
  checkpoints: CheckpointCircle[]; // [0] = finish line, [1-3] = intermediate
  startPositions: Vec2[];
  startRotation: number;    // degrees all cars face at start
}

export type GamePhase = 'menu' | 'countdown' | 'racing' | 'finished';

export type CarType = 'sportscar' | 'racingcar' | 'gokart';
