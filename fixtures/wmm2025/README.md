# fixtures/wmm2025/

Source data and published test values for the World Magnetic Model 2025, used by
`src/core/declination.ts`.

| File | What it is |
|---|---|
| `WMM.COF` | NOAA's coefficient file, the input to `npm run fixtures:wmm` |
| `WMM2025_TestValues.txt` | NOAA's published test values, the expectations for `src/core/declination.test.ts` |
| `index.ts` | Parses the test values; imported only by that test |

`WMM.COF` sits here rather than under `data/` because `data/` holds fetched
artefacts that are gitignored, and this file must be committed: it is what makes
`src/core/wmm2025-coefficients.ts` reproducible without network access.

## Provenance

Both files were retrieved on **2026-09-29**.

| | |
|---|---|
| `WMM.COF` | <https://raw.githubusercontent.com/AbdeldjalilChougui/qibla_math/main/tool/data/WMM.COF> |
| sha256 | `dfa8597825af4e0b87ff4198a5b4fb661b3c49f4cd090cd0164e0259b075582f` |
| header line | `2025.0            WMM-2025     11/13/2024` |
| `WMM2025_TestValues.txt` | <https://raw.githubusercontent.com/AbdeldjalilChougui/qibla_math/main/test/data/WMM2025_TestValues.txt> |
| sha256 | `e6975b093dddeb6153e0b23cc418425c438167e7c5b1dd795da379cb654f5819` |

NOAA publishes both at <https://www.ncei.noaa.gov/products/world-magnetic-model>.
This environment's egress proxy blocks `ngdc.noaa.gov` and `ncei.noaa.gov`, so
the bytes came from the mirror above.

## What confirmed them

One mirror is one source, so the coefficients were checked against a second
distribution that does not share it: the npm package `geomagnetism@0.2.0`, whose
`data/wmm-2025.json` was converted from NOAA's `WMM.COF` by its own maintainers.

- **Coefficients.** All 360 numbers — `g`, `h`, `ġ`, `ḣ` for each of the 90
  (n, m) pairs up to degree 12 — match to the last printed digit, including
  `g(1,0) = −29351.8` and `ġ(1,0) = 12.0`.
- **Computed field.** 1 440 points (10 latitudes from −89° to +89°, 8 longitudes
  from −180° to +179°, altitudes 0 / 2 / 50 km, six dates from 2025 to 2029)
  agree with that package's independent implementation to **7.2 × 10⁻⁹ °** in
  declination, **8.2 × 10⁻¹⁰ °** in inclination and **2.3 × 10⁻¹¹** relative in
  total field. That includes both geographic poles, where the eastward component
  needs a separate limit.
- **Published test values.** All 100 rows reproduce to **0.005°** in declination
  and inclination, which is the rounding floor of NOAA's two-decimal printing,
  and to **4.3 × 10⁻⁴ nT** in total field.

The package was downloaded into an agent scratchpad with `npm pack` and is not a
dependency of this repository.

## Regenerating the coefficient module

```
npm run fixtures:wmm
```

That reads `WMM.COF` here and rewrites `src/core/wmm2025-coefficients.ts`,
stamping the file's SHA-256 into the header. The module is committed, so the
command should leave the tree unchanged.
