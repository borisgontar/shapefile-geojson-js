/**
 * Checks if the first and last points are equal.
 * @param {number[][]} ring
 * @returns {boolean}
 */
function ringClosed(ring) {
    const l = ring.length - 1;
    if (l <= 2)
        throw new TypeError('SHPTransform: polygon ring too short.');
    return ring[0][0] == ring[l][0] && ring[0][1] == ring[l][1];
}

/**
 * Calculates signed area of the ring.
 * The area is positive if the ring is ordered counterclockwise.
 * Uses one of the formulas from
 * https://en.wikipedia.org/wiki/Shoelace_formula.
 * @param {number[][]} ring
 */
function ringArea(ring) {
    const l = ring.length;
    let sum = 0;
    for (let i = 0; i < l; i++) {
        const p = i > 0 ? i - 1 : l - 1;
        const n = i < l - 1 ? i + 1 : 0;
        sum += ring[i][1] * (ring[p][0] - ring[n][0]);
    }
    if (sum == 0)
        throw new TypeError('SHPTransform: polygon ring area is 0.');
    return 0.5 * sum;
}

/**
 * Calculates crossing number for point in a polygon.
 * The point is strictly inside if the number is odd.
 * The algorithm is taken from
 * https://web.archive.org/web/20130126163405/http://geomalgorithms.com/a03-_inclusion.html
 * @param {number[][]} ring
 * @param {number[]} p
 */
function insideRing(p, ring) {
    let count = 0;
    for (let i = 0; i < ring.length; i++) {
        const n = (i + 1) % ring.length;
        const ri = ring[i], rn = ring[n];
        if (((ri[1] <= p[1]) && (rn[1] > p[1]))     // an upward crossing
            || ((ri[1] > p[1]) && (rn[1] <= p[1]))) { // a downward crossing
            // compute  the actual edge-ray intersect x-coordinate
            const vt = (p[1] - ri[1]) / (rn[1] - ri[1]);
            if (p[0] < ri[0] + vt * (rn[0] - ri[0])) // P.x < intersect
                ++count;   // a valid crossing of y=P.y right of P.x
        }
    }
    return count;
}

/**
 * A simple check if two rings intersect.
 * @param {number[][]} ring
 * @param {number[][]} hole
 */
function ringIntersect(ring, b1, hole, b2) {
    const bb = bbox_intersection(b1, b2);
    if (!bb)
        return false;
    for (const p of hole) {
        if (!bbox_contains(bb, p))
            continue;
        const c = insideRing(p, ring);
        if (c !== 0)
            return (c & 0x01) !== 0;
    }
    for (const p of ring) {
        if (!bbox_contains(bb, p))
            continue;
        const c = insideRing(p, hole);
        if (c !== 0)
            return (c & 0x01) !== 0;
    }
    return false;
}

/**
 * @param {ArrayBuffer} bytes
 * @param {number} off
 * @param {Function} proj;
 */
export function parseBBox(bytes, off, proj) {
    const dv = new DataView(bytes);
    let [xmin, ymin] = proj([dv.getFloat64(off, true), dv.getFloat64(off+8, true)]);
    let [xmax, ymax] = proj([dv.getFloat64(off + 16, true), dv.getFloat64(off+24, true)]);
    return [xmin, ymin, xmax, ymax];
}

/**
 * @param {ArrayBuffer} bytes
 * @param {Function} proj;
 */
export function parseHeader(bytes, proj) {
    const dv = new DataView(bytes);
    if (dv.getInt32(0) != 9994)
        throw new TypeError('Not a Shapefile format');
    const filesize = dv.getInt32(24) * 2;
    const bbox = parseBBox(bytes, 36, proj);
    return { bbox, filesize };
}

/** @param {ArrayBuffer} bytes */
export function dbfHeader(bytes) {
    const dv = new DataView(bytes);
    const version = dv.getUint8(0) & 0x07;
    if (version != 3)
        throw new TypeError(`DBF format ${version} not implemented.`);
    const numrec = dv.getUint32(4, true);
    const reclen = dv.getUint16(10, true);
    if (dv.getUint8(15))
        throw new TypeError(`Encryped DBF not implemented.`);
    return { numrec, reclen };
}

/**
 * @param {ArrayBuffer} bytes
 * @param {number} pos
 */
export function dbfField(bytes, pos, decoder) {
    const dv = new DataView(bytes);
    if (dv.getUint8(pos) == 0x0d)
        return null;
    const name = decoder.decode(new DataView(bytes, pos, 11)).trim()
        .replace(/\0.*$/, '');
    //const type = bytes.subarray(pos + 11, pos + 12).toString('ascii');
    const type = String.fromCharCode(dv.getUint8(pos + 11));
    const size = dv.getUint8(pos + 16);
    //const count = dv.getUint8(pos + 17);
    return { name, type, size };
}

/** @param {DataView} rec */
export function dbfRecord(rec, fields, decoder) {
    const row = {};
    let pos = 0;
    for (const { name, type, size } of fields) {
        //const col = rec.subarray(pos + 1, pos + size + 1);
        const col = new DataView(rec.buffer, rec.byteOffset + pos + 1, size);
        switch (type) {
            case 'C': {
                const str = decoder.decode(col).trim();
                // it can be padded by zeros too
                let l = str.length;
                while (--l >= 0 && str.charCodeAt(l) == 0);
                row[name] = str.substring(0, l + 1);
                break;
            }
            case 'D':
                row[name] = decoder.decode(col).trim();
                break;
            case 'N':
            case 'F': {
                const str = decoder.decode(col).trim();
                row[name] = str == '' ? null : Number(str);
                break;
            }
            case 'L':
                switch (decoder.decode(col).toLowerCase().trim()) {
                    case 'y':
                    case 't':
                        row[name] = true;
                        break;
                    case 'n':
                    case 'f':
                        row[name] = false;
                        break;
                    default:
                        row[name] = null;
                }
                break;
            default:
                throw new TypeError(`DBF field type ${type} not implemented.`);
        }
        pos += size;
    }
    return row;
}

/**
 * @param {ArrayBuffer} bytes
 * @param {number} offset
 * @returns {GeoJSON.Feature}
 */
export function parseRecord(bytes, offset, proj) {
    const dv = new DataView(bytes);
    const type = dv.getInt32(offset, true);
    switch (type) {
        case 0:
            return { type: 'Feature', geometry: null, properties: null };
        case 1: { // Point
            const [x, y] = proj([
                dv.getFloat64(offset + 4, true),
                dv.getFloat64(offset + 12, true)]);
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [x, y] },
                properties: null
            };
        }
        case 3:     // Polyline
        case 5: {   // Polygon
            const bbox = parseBBox(bytes, offset + 4, proj);
            const nparts = dv.getInt32(offset + 36, true);
            const npoints = dv.getInt32(offset + 40, true);
            const parts = Array(nparts);
            const points = Array(npoints);
            let pos = offset + 44;
            for (let i = 0; i < nparts; i++) {
                parts[i] = dv.getInt32(pos, true);
                pos += 4;
            }
            const lines = Array(nparts);
            for (let i = 0; i < npoints; i++) {
                const x = dv.getFloat64(pos, true);
                pos += 8;
                const y = dv.getFloat64(pos, true);
                pos += 8;
                points[i] = proj([x, y]);
            }
            for (let i = 0; i < nparts; i++) {
                const i0 = parts[i];
                const i1 = i < nparts - 1 ? parts[i + 1] : npoints;
                lines[i] = points.slice(i0, i1);
            }
            if (type == 3) {
                return {
                    type: 'Feature',
                    bbox: bbox,
                    geometry: {
                        type: nparts == 1 ? 'LineString' : 'MultiLineString',
                        coordinates: nparts == 1 ? lines[0] : lines
                    },
                    properties: null
                }
            }
            // now it's a polygon
            const rings = [];
            for (const ring of lines) {
                if (!ringClosed(ring))
                    throw new TypeError('SHPTransform: polygon: ring not closed.');
                const area = ringArea(ring);   // area < 0 for outer rings
                if (area == 0)
                    throw new TypeError('SHPTransform: polygon: ring area is zero.');
                rings.push({ ring: ring, area, bbox: bbox_of(ring), outer: null });
            }
            // sorting to make sure that an inner gets into the smallest outer
            rings.sort((r1, r2) => r1.area - r2.area);
            const outers = rings.filter(r => r.area < 0);
            const inners = rings.filter(r => r.area > 0);
            for (const hole of inners) {
                // inner of which outer?
                for (const outer of outers) {
                    if (hole.area >= Math.abs(outer.area))
                        continue;
                    if (ringIntersect(outer.ring, outer.bbox, hole.ring, hole.bbox)) {
                        hole.outer = outer;
                        break;
                    }
                }
                if (!hole.outer) {
                    // it's not a hole?
                    hole.ring.reverse();
                    hole.area = -hole.area;
                    outers.push(hole);
                    inners[inners.indexOf(hole)] = null;
                    console.log('SHPTransform: polygon: orphan inner ring.');
                }
            }
            if (outers.length == 0)
                throw new TypeError('SHPTransform: polygon: no outer rings.');
            //
            for (const r of outers)
                r.ring = [r.ring.reverse()];
            for (const h of inners) {
                if (h)
                    h.outer.ring.push(h.ring.reverse());
            }
            const geometry = {
                type: outers.length == 1 ? 'Polygon' : 'MultiPolygon',
                coordinates: outers.length == 1 ? outers[0].ring
                    : [...outers.map(o => o.ring)]
            }
            return { type: 'Feature', bbox: bbox, geometry, properties: null };
        }
        case 8: {  // MultiPoint
            const bbox = parseBBox(bytes, offset + 4, proj);
            const num = dv.getInt32(offset + 36, true);
            const points = Array(num);
            let pos = offset + 40;
            for (let i = 0; i < num; i++) {
                const x = dv.getFloat64(pos, true);
                pos += 8;
                const y = dv.getFloat64(pos, true);
                pos += 8;
                points[i] = proj([x, y]);
            }
            return {
                type: 'Feature',
                bbox: bbox,
                geometry: { type: 'MultiPoint', coordinates: points },
                properties: null
            };
        }
        default:
            throw new TypeError(`SHPTransform: record type ${type} not implemented.`);
    }
}

/** @param {GeoJSON.BBox} b
function bbox_valid(b) {
    const [ w, s, e, n ] = b;
    return w <= e && s <= n;
}
 */
/**
 * @param {GeoJSON.BBox} b1
 * @param {GeoJSON.BBox} b2

function bbox_union(b1, b2) {
    return [
        Math.min(b1[0], b2[0]),
        Math.min(b1[1], b2[1]),
        Math.max(b1[2], b2[2]),
        Math.max(b1[3], b2[3])
    ];
}
*/
/**
 * @param {GeoJSON.BBox} b1
 * @param {GeoJSON.BBox} b2
 */
function bbox_intersection(b1, b2) {
    const [w1, s1, e1, n1] = b1;
    const [w2, s2, e2, n2] = b2;
    if (e1 < w2 || e2 < w1 || s1 > n2 || s2 > n1)
        return null;
    const w = Math.max(w1, w2);
    const s = Math.max(s1, s2);
    const e = Math.min(e1, e2);
    const n = Math.min(n1, n2);
    return [w, s, e, n];
}

/** @param {GeoJSON.LineString} line */
function bbox_of(line) {
    let w = Number.MAX_SAFE_INTEGER,
        s = Number.MAX_SAFE_INTEGER,
        e = -Number.MAX_SAFE_INTEGER,
        n = -Number.MAX_SAFE_INTEGER;
    for (const p of line) {
        const [x, y] = p;
        if (x < w) w = x;
        if (x > e) e = x;
        if (y > n) n = y;
        if (y < s) s = y;
    }
    return [w, s, e, n];
}

/**
 * Is this point within bbox, borders included?
 * @param {GeoJSON.BBox} b
 * @param {GeoJSON.Point} p
 */
function bbox_contains(b, p) {
    const [w, s, e, n] = b;
    const [x, y] = p;
    return x >= w && x <= e && y >= s && y <= n;
}
