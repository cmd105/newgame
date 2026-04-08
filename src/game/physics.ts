/**
 * Car physics — ported from GML (GameMaker kill_sideway_speed + car_update).
 *
 * Coordinate system: rotation 0 = north (y-decreasing), clockwise positive.
 * All speeds in pixels / frame (at 60 fps).
 */

import { Car } from './types';

const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d >  180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * kill_sideway_speed — removes lateral velocity from the car.
 * `drift` (1 = full grip, near 0 = slide freely).
 * Direct port of the GML script.
 */
function killSidewaySpeed(car: Car): void {
  const rad = car.rotation * DEG;
  // Lateral (right) axis of the car body
  const lx =  Math.cos(rad);
  const ly =  Math.sin(rad);
  const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
  // Project velocity onto lateral axis
  let mag = lx * car.vx + ly * car.vy;
  // Drift factor: allow some side-slip proportional to speed
  mag *= car.drift / Math.max(speed, 1);
  car.vx -= mag * lx;
  car.vy -= mag * ly;
}

/**
 * updateCar — main physics step (port of car_update GML).
 * @param acc   -1 = brake/reverse, 0 = coast, 1 = accelerate
 * @param steer target wheel angle in degrees (−maxWheelAngle … +maxWheelAngle)
 * @param dt    delta-time multiplier (1.0 at 60 fps)
 */
export function updateCar(car: Car, acc: number, steer: number, dt = 1): void {
  const speed  = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
  const rad    = car.rotation * DEG;
  // Forward unit vector
  const fx     =  Math.sin(rad);
  const fy     = -Math.cos(rad);

  const movingFwd = car.vx * fx + car.vy * fy > 0;

  // ── Engine force ──────────────────────────────────────────
  if (acc === 1 && speed < car.maxSpeed) {
    car.vx += fx * car.engineAcc * dt;
    car.vy += fy * car.engineAcc * dt;
  } else if (acc === -1) {
    if (movingFwd) {
      car.vx += fx * (-car.engineBrk) * dt;
      car.vy += fy * (-car.engineBrk) * dt;
    } else if (speed < car.maxSpeedRev) {
      car.vx += fx * (-car.engineRev) * dt;
      car.vy += fy * (-car.engineRev) * dt;
    }
  }

  // ── Grip (kill sideways speed) ────────────────────────────
  killSidewaySpeed(car);

  // ── Wheel angle (steering) ────────────────────────────────
  const targetAngle = clamp(steer, -car.maxWheelAngle, car.maxWheelAngle);
  const dAngle = angleDiff(targetAngle, car.wheelAngle);
  car.wheelAngle += clamp(dAngle, -car.wheelAngleVelocity, car.wheelAngleVelocity) * dt;

  // ── Torque (angular acceleration) ────────────────────────
  const torq  = movingFwd ? car.torqueAcc : car.torqueRev;
  const mspd  = movingFwd ? car.maxSpeed  : car.maxSpeedRev;
  car.angularVelocity +=
    torq * Math.sign(car.wheelAngle) * Math.min(speed * 2 / mspd, 1) * dt;

  // ── Angular damping when wheel is centred ─────────────────
  if (Math.abs(car.wheelAngle) < 1) {
    const damp = car.torqueDamp * dt;
    car.angularVelocity =
      Math.abs(car.angularVelocity) < damp
        ? 0
        : car.angularVelocity - Math.sign(car.angularVelocity) * damp;
  }

  // ── Clamp angular velocity ────────────────────────────────
  car.angularVelocity = clamp(car.angularVelocity, -4.5, 4.5);

  // ── Integrate ─────────────────────────────────────────────
  car.rotation += car.angularVelocity * dt;
  car.x        += car.vx              * dt;
  car.y        += car.vy              * dt;

  // ── Full stop when nearly still ───────────────────────────
  if (speed < 0.12 && acc === 0) {
    car.vx              *= 0.5;
    car.vy              *= 0.5;
    car.angularVelocity *= 0.5;
  }
}
