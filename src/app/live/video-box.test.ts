/**
 * Where the camera image lands, and what field of view survives the crop.
 *
 * Every expectation is derived by hand from the `object-fit: cover` rule and
 * the rectilinear tangent relation, and the derivation is written beside it.
 * Nothing here was produced by running the code.
 *
 * The rule: `cover` scales the decoded frame by `s = max(boxW/frameW,
 * boxH/frameH)`, centres it, and discards the overflow. The visible fraction of
 * an axis is `box / (frame · s)`, and a crop keeping fraction `f` of an axis
 * keeps tangent fraction `f` of that axis's half-angle.
 */

import { describe, expect, it } from 'vitest';

import { croppedFovDeg, videoBoxGeometry } from './video-box';

const DEG = Math.PI / 180;

describe('videoBoxGeometry', () => {
  it('crops the height of a 4:3 frame shown in a 16:9 landscape box', () => {
    // 1200×900 frame in an 800×450 box.
    //   s = max(800/1200, 450/900) = max(2/3, 1/2) = 2/3
    //   rendered = 800 × 600
    //   visible  = 800/800 = 1 across, 450/600 = 0.75 down
    //   overflow = (800−800)/2 = 0 across, (600−450)/2 = 75 down
    const geometry = videoBoxGeometry({ widthPx: 800, heightPx: 450 }, { widthPx: 1200, heightPx: 900 });

    expect(geometry.scale).toBeCloseTo(2 / 3, 12);
    expect(geometry.visibleFraction.x).toBeCloseTo(1, 12);
    expect(geometry.visibleFraction.y).toBeCloseTo(0.75, 12);
    expect(geometry.overflowPx.xPx).toBeCloseTo(0, 12);
    expect(geometry.overflowPx.yPx).toBeCloseTo(75, 12);
  });

  it('crops the width of a 4:3 frame shown in a tall box', () => {
    // 1200×900 frame in a 450×800 box (a phone still in portrait).
    //   s = max(450/1200, 800/900) = max(0.375, 8/9) = 8/9
    //   rendered = 1066.666… × 800
    //   visible  = 450/(1200·8/9) = 450/1066.666… = 0.421875 across, 1 down
    //   overflow = (1066.666…−450)/2 = 308.333… across, 0 down
    const geometry = videoBoxGeometry({ widthPx: 450, heightPx: 800 }, { widthPx: 1200, heightPx: 900 });

    expect(geometry.scale).toBeCloseTo(8 / 9, 12);
    expect(geometry.visibleFraction.x).toBeCloseTo(0.421875, 12);
    expect(geometry.visibleFraction.y).toBeCloseTo(1, 12);
    expect(geometry.overflowPx.xPx).toBeCloseTo(1850 / 6, 9);
    expect(geometry.overflowPx.yPx).toBeCloseTo(0, 12);
  });

  it('crops nothing when the box already has the frame’s aspect ratio', () => {
    // 1200×900 in 600×450: s = 0.5 on both axes, so nothing is discarded.
    const geometry = videoBoxGeometry({ widthPx: 600, heightPx: 450 }, { widthPx: 1200, heightPx: 900 });
    expect(geometry.scale).toBeCloseTo(0.5, 12);
    expect(geometry.visibleFraction.x).toBe(1);
    expect(geometry.visibleFraction.y).toBe(1);
    expect(geometry.overflowPx.xPx).toBeCloseTo(0, 12);
    expect(geometry.overflowPx.yPx).toBeCloseTo(0, 12);
  });

  it('never reports more of the frame visible than the frame has', () => {
    // The axis that exactly fits can land a hair over 1 in floating point, and
    // a fraction over 1 would claim the screen shows unrecorded picture.
    for (const box of [
      { widthPx: 1179, heightPx: 2556 },
      { widthPx: 2556, heightPx: 1179 },
      { widthPx: 1000, heightPx: 1000 },
    ]) {
      const geometry = videoBoxGeometry(box, { widthPx: 1920, heightPx: 1080 });
      expect(geometry.visibleFraction.x).toBeLessThanOrEqual(1);
      expect(geometry.visibleFraction.y).toBeLessThanOrEqual(1);
    }
  });

  it('puts the principal point at the centre of the element box', () => {
    // A centred `cover` maps the frame's centre to the box's centre, whatever
    // the crop. The overlay's own projection assumes this, so it is asserted
    // rather than trusted.
    const geometry = videoBoxGeometry({ widthPx: 874, heightPx: 402 }, { widthPx: 1280, heightPx: 720 });
    expect(geometry.principalPointPx).toEqual({ xPx: 437, yPx: 201 });
  });

  it('moves the principal point with the element box, not with the viewport', () => {
    // The same 800×450 box, measured after a layout that inset it. What the
    // caller passes is the ELEMENT box, so the principal point is its own
    // centre — this is what stays right if the layout ever insets the video.
    const full = videoBoxGeometry({ widthPx: 800, heightPx: 450 }, { widthPx: 1200, heightPx: 900 });
    const inset = videoBoxGeometry({ widthPx: 740, heightPx: 416 }, { widthPx: 1200, heightPx: 900 });
    expect(full.principalPointPx).toEqual({ xPx: 400, yPx: 225 });
    expect(inset.principalPointPx).toEqual({ xPx: 370, yPx: 208 });
  });

  describe('safe area', () => {
    it('reports the box no notch covers, and the widest inset as the margin', () => {
      // An iPhone in landscape: notch on the left short edge, home indicator
      // along the bottom. Safe box = 800−59−0 wide, 450−0−21 tall, at (59, 0).
      const geometry = videoBoxGeometry(
        { widthPx: 800, heightPx: 450 },
        { widthPx: 1200, heightPx: 900 },
        { leftPx: 59, bottomPx: 21 },
      );
      expect(geometry.safeBoxPx).toEqual({ xPx: 59, yPx: 0, widthPx: 741, heightPx: 429 });
      expect(geometry.labelMarginPx).toBe(59);
      // The insets must not move the optical axis: the overlay spans the whole
      // element box, so its centre is still the box centre.
      expect(geometry.principalPointPx).toEqual({ xPx: 400, yPx: 225 });
    });

    it('treats a missing, negative or non-finite inset as zero', () => {
      const geometry = videoBoxGeometry(
        { widthPx: 800, heightPx: 450 },
        { widthPx: 1200, heightPx: 900 },
        { leftPx: -12, rightPx: Number.NaN, topPx: 0 },
      );
      expect(geometry.safeBoxPx).toEqual({ xPx: 0, yPx: 0, widthPx: 800, heightPx: 450 });
      expect(geometry.labelMarginPx).toBe(0);
    });

    it('never reports a negative safe box for insets wider than the screen', () => {
      const geometry = videoBoxGeometry(
        { widthPx: 100, heightPx: 80 },
        { widthPx: 1200, heightPx: 900 },
        { leftPx: 70, rightPx: 70, topPx: 50, bottomPx: 50 },
      );
      expect(geometry.safeBoxPx.widthPx).toBe(0);
      expect(geometry.safeBoxPx.heightPx).toBe(0);
    });
  });

  it('is finite before layout and before the first frame', () => {
    // A React component renders once with a 0×0 element and a stream whose
    // videoWidth is still 0. NaN there would poison the pose and every label.
    for (const [box, frame] of [
      [{ widthPx: 0, heightPx: 0 }, { widthPx: 1200, heightPx: 900 }],
      [{ widthPx: 800, heightPx: 450 }, { widthPx: 0, heightPx: 0 }],
      [{ widthPx: Number.NaN, heightPx: 450 }, { widthPx: 1200, heightPx: 900 }],
    ] as const) {
      const geometry = videoBoxGeometry(box, frame);
      expect(Number.isFinite(geometry.scale)).toBe(true);
      expect(geometry.visibleFraction.x).toBe(1);
      expect(geometry.visibleFraction.y).toBe(1);
    }
  });
});

describe('croppedFovDeg', () => {
  it('keeps the uncropped axis and shrinks the cropped one by tangent', () => {
    // A 4:3 frame at hFOV 90° has tan(v/2) = tan45°·(900/1200) = 0.75, so
    // vFOV = 2·atan(0.75). Shown in a 16:9 box, 0.75 of the height survives:
    //   tan(v_box/2) = 0.75 · 0.75 = 0.5625  →  v_box = 2·atan(0.5625)
    const full = { hFovDeg: 90, vFovDeg: (2 * Math.atan(0.75)) / DEG };
    const cropped = croppedFovDeg(full, { x: 1, y: 0.75 });

    expect(cropped.hFovDeg).toBeCloseTo(90, 10);
    expect(cropped.vFovDeg).toBeCloseTo((2 * Math.atan(0.5625)) / DEG, 10);
  });

  it('shrinks the angle by LESS than the fraction — the error this prevents', () => {
    // Scaling the ANGLE by the fraction is the tempting mistake. At hFOV 90°
    // with 0.75 of the height visible, the tangent rule gives 2·atan(0.5625) =
    // 58.3°, while scaling the 73.74° angle by 0.75 gives 55.3°: 3° apart, and
    // every label placed by the wrong one drifts further from frame centre.
    const full = { hFovDeg: 90, vFovDeg: (2 * Math.atan(0.75)) / DEG };
    const cropped = croppedFovDeg(full, { x: 1, y: 0.75 });
    expect(cropped.vFovDeg).toBeGreaterThan(full.vFovDeg * 0.75);
    expect(cropped.vFovDeg).toBeLessThan(full.vFovDeg);
  });

  it('is the identity for an uncropped box', () => {
    const full = { hFovDeg: 65.4704525442152, vFovDeg: 51.481 };
    expect(croppedFovDeg(full, { x: 1, y: 1 })).toEqual(full);
  });

  it('refuses a degenerate field or fraction with 0 rather than NaN', () => {
    expect(croppedFovDeg({ hFovDeg: 0, vFovDeg: 45 }, { x: 1, y: 1 }).hFovDeg).toBe(0);
    expect(croppedFovDeg({ hFovDeg: 180, vFovDeg: 45 }, { x: 1, y: 1 }).hFovDeg).toBe(0);
    expect(croppedFovDeg({ hFovDeg: 60, vFovDeg: 45 }, { x: 0, y: 1 }).hFovDeg).toBe(0);
  });

  it('clamps a fraction over 1 rather than inventing field of view', () => {
    const full = { hFovDeg: 60, vFovDeg: 45 };
    expect(croppedFovDeg(full, { x: 1.4, y: 1 }).hFovDeg).toBeCloseTo(60, 12);
  });
});

describe('the whole chain, end to end', () => {
  it('turns a 1200×900 stream in an 800×450 window into the visible field', () => {
    // The exact case the e2e drives. The frame's own field at 24 mm-equivalent
    // is 2·atan(36/48) = 2·atan(0.75) across the long (1200 px) axis, and
    // tan(v/2) = 0.75·(900/1200) = 0.5625 down it. The 16:9 window keeps 0.75
    // of the height, so tan(v_box/2) = 0.5625·0.75 = 0.421875.
    const geometry = videoBoxGeometry(
      { widthPx: 800, heightPx: 450 },
      { widthPx: 1200, heightPx: 900 },
    );
    const frameFov = {
      hFovDeg: (2 * Math.atan(0.75)) / DEG,
      vFovDeg: (2 * Math.atan(0.5625)) / DEG,
    };
    const visible = croppedFovDeg(frameFov, geometry.visibleFraction);

    expect(visible.hFovDeg).toBeCloseTo((2 * Math.atan(0.75)) / DEG, 10);
    expect(visible.vFovDeg).toBeCloseTo((2 * Math.atan(0.421875)) / DEG, 10);
  });
});
