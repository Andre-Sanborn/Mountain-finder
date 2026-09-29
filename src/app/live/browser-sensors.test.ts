import { describe, expect, it } from 'vitest';

import { BrowserSensorTraces } from './browser-sensors';
import type { WebOrientationEventLike } from '../../live/web-sensors';

/**
 * ## Where the yaw expectations come from
 *
 * The § A.1 camera bearing, written out by hand rather than read off the code.
 * With γ = 0 and β = 90° the rear camera is level and
 *
 *     Vx = −cos α · sin γ − sin α · sin β · cos γ = −sin α
 *     Vy = −sin α · sin γ + cos α · sin β · cos γ =  cos α
 *     yaw = atan2(−sin α, cos α) = −α, folded onto [0, 360)
 *
 * so α = 137° is a yaw of 223°, and α = 92° is a yaw of 268°. The difference,
 * 45°, is the turn the phone made.
 */
function windowStub(): Window {
  return { screen: { orientation: { angle: 0 } } } as unknown as Window;
}

function traces(): BrowserSensorTraces {
  let tMs = 0;
  return new BrowserSensorTraces(windowStub(), () => (tMs += 16));
}

function relative(alpha: number): WebOrientationEventLike {
  return { alpha, beta: 90, gamma: 0, absolute: false };
}

function absolute(alpha: number): WebOrientationEventLike {
  return { alpha, beta: 90, gamma: 0, absolute: true };
}

describe('BrowserSensorTraces device yaw', () => {
  it('reads the camera yaw off a relative-alpha event', () => {
    const sensors = traces();
    sensors.ingestOrientation(relative(137));
    expect(sensors.status().deviceYawDeg).toBeCloseTo(223, 10);
    sensors.ingestOrientation(relative(92));
    expect(sensors.status().deviceYawDeg).toBeCloseTo(268, 10);
  });

  it('ignores an earth-referenced alpha, which is the compass answering again', () => {
    // An absolute alpha comes from the magnetometer, so a compass fault would
    // move it in step with the compass and the drift check would see nothing.
    const sensors = traces();
    sensors.ingestOrientation(absolute(137), 'deviceorientationabsolute');
    expect(sensors.status().deviceYawDeg).toBeUndefined();

    sensors.ingestOrientation(relative(137));
    sensors.ingestOrientation(absolute(200), 'deviceorientationabsolute');
    expect(sensors.status().deviceYawDeg).toBeCloseTo(223, 10);
  });

  it('has no yaw before any orientation event, and none from a null alpha', () => {
    const sensors = traces();
    expect(sensors.status().deviceYawDeg).toBeUndefined();
    sensors.ingestOrientation({ alpha: null, beta: 90, gamma: 0, absolute: false });
    expect(sensors.status().deviceYawDeg).toBeUndefined();
  });

  it('drops the yaw while the camera points within a degree of straight up', () => {
    // β = 0 puts the rear camera along the earth's vertical, where a bearing
    // off the rotation matrix has no meaning.
    const sensors = traces();
    sensors.ingestOrientation(relative(137));
    expect(sensors.status().deviceYawDeg).toBeCloseTo(223, 10);
    sensors.ingestOrientation({ alpha: 137, beta: 0, gamma: 0, absolute: false });
    expect(sensors.status().deviceYawDeg).toBeUndefined();
  });
});
