import { test } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_SETTINGS } from '../src/config/defaults';
import { createCalmEnvironment } from '../src/env/environment';
import { Simulation } from '../src/game/simulation';
import type { PlaneVehicle } from '../src/vehicles/planeVehicle';
import { attitude } from '../src/fc/planeController';
const R2D = 180 / Math.PI;
test('planes', () => {
  for (const id of ['trainer', 'wing', 'glider']) {
    for (const mode of ['manual', 'gyro', 'angle'] as const) {
      for (const thr of [0, 0.5]) {
        const s = structuredClone(DEFAULT_SETTINGS); s.vehicle = id; s.planeMode = mode;
        const sim = new Simulation(createCalmEnvironment(), s);
        const v = sim.vehicle as PlaneVehicle;
        sim.reset(new Vector3(0, 100, 0));
        // start level at 14 m/s
        v.body.orientation.identity(); v.body.velocity.set(0, 0, id === "wing" ? -16 : id === "glider" ? -9.5 : -12);
        const st = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
        sim.step(st); st.throttle = thr;
        const y0 = v.body.position.y;
        const log: string[] = [];
        for (let i = 1; i <= 12000; i++) {
          sim.step(st);
          if (i % 2000 === 0) { const a = attitude(v.body.orientation); log.push(`${i/1000}s V${v.telemetry.airspeed.toFixed(1)} θ${(a.pitch*R2D).toFixed(0)} φ${(a.bank*R2D).toFixed(0)} α${v.telemetry.alphaDeg.toFixed(1)} h${(v.body.position.y-y0).toFixed(0)}`); }
        }
        const sink = v.body.velocity.y; const hs = Math.hypot(v.body.velocity.x, v.body.velocity.z);
        console.log(id, mode, 'thr', thr, log.join(' | '), 'L/D', (hs / -sink).toFixed(1));
      }
    }
  }
});
