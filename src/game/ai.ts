/**
 * AI car update — port of car_ai_update + car_ai_move GML scripts.
 *
 * Each AI car follows the circuit waypoints in order,
 * advancing when close enough and steering toward the current target.
 */

import { Car, Track } from './types';
import { updateCar } from './physics';

const DEG = Math.PI / 180;

export function updateAI(car: Car, track: Track, dt = 1): void {
  const wps = track.waypoints;
  const n   = wps.length;

  // Current target waypoint
  const idx    = car.aiWaypointIndex % n;
  const target = wps[idx];

  const dx   = target.x - car.x;
  const dy   = target.y - car.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Advance to next waypoint when close enough
  if (dist < 100) {
    car.aiWaypointIndex = (car.aiWaypointIndex + 1) % n;
  }

  // Angle from car to target: 0 = north, clockwise positive
  const targetAngle = (Math.atan2(dx, -dy) / DEG + 360) % 360;
  const carAngle    = ((car.rotation % 360) + 360) % 360;

  let diff = targetAngle - carAngle;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;

  // --- car_ai_move logic ---
  // Steer proportionally toward target, clamped by maxWheelAngle
  const steer = -Math.max(-car.maxWheelAngle, Math.min(car.maxWheelAngle, diff * 0.7));

  // Accelerate, but slow down for tight turns (mirrors car_ai_move angle-based speed control)
  let acc = 1;
  if (Math.abs(diff) > 30) acc = 0;
  if (Math.abs(diff) > 65) acc = -1;

  updateCar(car, acc, steer, dt);
}
