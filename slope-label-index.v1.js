export const DEFAULT_SLOPE_LABEL_CELL_METERS = 200;

export function buildSlopeAngleSpatialIndex(records, cellSize = DEFAULT_SLOPE_LABEL_CELL_METERS) {
  const size = Number.isFinite(Number(cellSize)) && Number(cellSize) > 0
    ? Number(cellSize)
    : DEFAULT_SLOPE_LABEL_CELL_METERS;
  const cells = new Map();
  let recordCount = 0;
  for (const record of records || []) {
    const x = Number(record?.x), z = Number(record?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const key = Math.floor(x / size) + ':' + Math.floor(z / size);
    let bucket = cells.get(key);
    if (!bucket) { bucket = []; cells.set(key, bucket); }
    bucket.push(record);
    recordCount++;
  }
  return { cellSize:size, cells, recordCount };
}

export function forEachSlopeAngleSpatialCandidate(index, x, z, radius, visit) {
  if (!index?.cells || typeof visit !== 'function') return 0;
  const centerX=Number(x),centerZ=Number(z),reach=Math.max(0,Number(radius)||0);
  if (!Number.isFinite(centerX)||!Number.isFinite(centerZ)) return 0;
  const cellRadius=Math.ceil(reach/index.cellSize);
  const cellX=Math.floor(centerX/index.cellSize),cellZ=Math.floor(centerZ/index.cellSize);
  let visited=0;
  for(let zCell=cellZ-cellRadius;zCell<=cellZ+cellRadius;zCell++){
    for(let xCell=cellX-cellRadius;xCell<=cellX+cellRadius;xCell++){
      const bucket=index.cells.get(xCell+':'+zCell);
      if(!bucket)continue;
      for(const record of bucket){visit(record);visited++;}
    }
  }
  return visited;
}
