/**
 * Data providers (archive/v2-docs-20260929/PLAN.md Phase 2).
 *
 * Everything the pipeline needs from the outside world. Elevation comes from
 * LOCAL SRTM tiles (`tile-elevation.js`); the HTTP clients behind the injectable
 * transport remain for peaks and for acquisition. Import `fixture-store.js` and
 * `tile-directory.js` separately — both are node-only.
 */

export { ProviderError, isProviderError } from './errors.js';
export type { ProviderErrorCode, ProviderErrorDetails } from './errors.js';

export {
  canonicalBody,
  canonicalUrl,
  fixtureKey,
  fixtureKeyHash,
  parseJsonBody,
} from './transport.js';
export type {
  HttpMethod,
  RequestBody,
  Sleep,
  Transport,
  TransportRequest,
  TransportResponse,
} from './transport.js';

export { FetchTransport } from './fetch-transport.js';
export type { FetchLike, FetchTransportOptions } from './fetch-transport.js';

export { FixtureTransport, exchangeBodyText } from './fixture-transport.js';
export type { RecordedExchange } from './fixture-transport.js';

export {
  MAX_LOCATIONS_PER_REQUEST,
  OpenTopoDataElevationProvider,
  SRTM90M_URL,
  batchPoints,
  elevationRequestUrl,
  formatLocations,
  toElevationSamples,
} from './elevation.js';
export type {
  ElevationProvider,
  ElevationRequestOptions,
  ElevationResult,
  NoDataPolicy,
  OpenTopoDataOptions,
} from './elevation.js';

export {
  BYTES_PER_SAMPLE,
  HgtTile,
  SRTM1_GRID_SIZE,
  SRTM3_GRID_SIZE,
  VOID_SAMPLE,
  decodeBigEndianInt16,
  encodeBigEndianInt16,
  gridSizeForByteLength,
  parseGridWindow,
  parseHgtTile,
} from './hgt-tile.js';
export type {
  GridGeometry,
  ReadOptions,
  TileReading,
  TileReadingMethod,
  VoidPolicy,
} from './hgt-tile.js';

export {
  MemoryTileStore,
  lonOffsetEastDeg,
  lonWidthDeg,
  lonWithinBounds,
  normaliseLon,
  parseNamedTile,
  parseTileName,
  tileCornerFor,
  tileNameFor,
  tileNameForCorner,
  tileNamesForBounds,
} from './tile-store.js';
export type { TileBounds, TileCorner, TileStore } from './tile-store.js';

export {
  DEFAULT_TERRAIN_MANIFEST_URL,
  TERRAIN_MANIFEST_VERSION,
  expectedGridByteLength,
  gridAreaDeg2,
  gridContains,
  parseTerrainManifest,
  selectTerrainGrid,
  terrainGridBounds,
  terrainGridForTileFile,
} from './terrain-manifest.js';
export type { TerrainGrid, TerrainManifest } from './terrain-manifest.js';

export { HttpTerrainStore, resolveTerrainUrl } from './http-terrain-store.js';
export type {
  HttpTerrainStoreOptions,
  TerrainCoverage,
  TerrainFetch,
  TerrainFetchResponse,
} from './http-terrain-store.js';

export {
  MISSING_TILE_DATASET,
  TileElevationProvider,
  datasetLabelForGridSize,
  datasetLabelForStepDeg,
} from './tile-elevation.js';
export type { TerrainSample, TerrainStatus, TileElevationOptions } from './tile-elevation.js';

export {
  bilinearTerrain,
  buildSyntheticHgtBytes,
  buildSyntheticTile,
  coneTerrain,
  constantTerrain,
  syntheticGeometry,
  withVoidBlock,
} from './synthetic-tile.js';
export type { SyntheticTileSpec, TerrainFunction } from './synthetic-tile.js';

export {
  OVERPASS_URL,
  OverpassPeaksProvider,
  buildPeaksQuery,
  feetToMetres,
  parseEleFeet,
  parseEleMetres,
  parsePeaksResponse,
  resolvePeakElevations,
} from './peaks.js';
export type {
  BoundingBox,
  OverpassOptions,
  PeakCandidate,
  PeakSearchArea,
  PeaksProvider,
  PeaksRequestOptions,
  ResolvedPeaks,
} from './peaks.js';

export {
  LocalPeakStore,
  compareRecordId,
  parsePeakDataset,
  toPeak,
  toPeakCandidate,
} from './peak-store.js';
export type {
  PeakDataset,
  PeakRecord,
  PeakRecordSighting,
  PeakSourceAccess,
  PeakSourceRecord,
} from './peak-store.js';

export {
  TiledPeakStore,
  boundingBoxAround,
  cellNameForPeak,
  parsePeakCell,
  parsePeakCellIndex,
} from './peak-tile-store.js';
export type {
  PeakCellEntry,
  PeakCellIndex,
  PeakCellLoader,
  PeakCoverage,
  PeakCoveragePolicy,
  TiledPeakStoreOptions,
} from './peak-tile-store.js';

// The pure half of the Overture importer only. `overture-parquet.js` (hyparquet
// + zstd), `parquet-slice.js` and `peak-directory.js` are deliberately NOT
// re-exported here: they belong to the acquisition path and to tests, and
// hanging a parquet decoder off the barrel every app module imports would put
// it in the browser bundle for nothing. Import them by path, like
// `fixture-store.js` and `tile-directory.js`.
export {
  DEFAULT_SUMMIT_CLASSES,
  OVERTURE_ELEVATION_SOURCE,
  OVERTURE_ID_PREFIX,
  OVERTURE_LANDFORM_SUBTYPE,
  OVERTURE_LAND_COLUMNS,
  POINT_BBOX_TOLERANCE_DEG,
  boxContains,
  boxesIntersect,
  classifyOvertureRow,
  importOvertureRows,
  pointFromBbox,
  readOvertureLandRow,
} from './overture-peaks.js';
export type {
  DegreeBox,
  OvertureBbox,
  OvertureImportOptions,
  OvertureLandFeature,
  OvertureRejection,
  OvertureRowOutcome,
} from './overture-peaks.js';
