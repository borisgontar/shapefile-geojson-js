if (TransformStream == undefined) {
    // eslint-disable-next-line no-global-assign
    TransformStream = await import('node:stream/web');
}
import proj4 from 'proj4';
import { shpRecord, shpHeader, dbfHeader, dbfField, dbfRecord } from './common.js';

/**
 * Returns TransformStream of features converted from a SHP ReadableStream.
 * @param {number[]} bbox Will fill with bounding box
 * @param {string} [prjwkt] Projection in WKT format.
 * @param {boolean} [withM] Include the M coordinate.
 * @returns TransformStream
 */
export function SHPTransform(bbox, prjwkt = '', withM = false) {
    /** @type {ArrayBuffer | null} */
    let buffer = null;
    let offset = 0;     // current offset in the buffer
    let needed = 100;   // number of bytes required in the buffer
    let status = 0;
    let filesize = 0;
    let project = (x) => x;
    //
    if (bbox && !(Array.isArray(bbox) && bbox.length >= 4))
        throw new TypeError('SHPTransform: first arg: array for bbox expected.');
    if (prjwkt && typeof prjwkt != 'string')
        throw new TypeError('SHPTransform: second arg: string expected.');
    if (prjwkt)
        project = proj4(prjwkt).inverse;
    //
    return new TransformStream({
        transform(chunk, controller) {
            if (buffer == null)
                buffer = chunk.buffer;
            else {
                const rem = new Uint8Array(buffer.slice(offset));
                const tmp = new Uint8Array(rem.byteLength + chunk.length);
                tmp.set(rem, 0);
                tmp.set(chunk, rem.byteLength);
                buffer = tmp.buffer;
                offset = 0;
            }
            while (true) {
                if (buffer.byteLength - offset < needed)
                    return;       // _transform will be called with the next chunk
                const data = new DataView(buffer);
                if (status == 0) {
                    const header = shpHeader(buffer, project);
                    if (bbox) {
                        for (let i = 0; i < 4; i++)
                            bbox[i] = header.bbox[i];
                    }
                    filesize = header.filesize - 100;
                    status = 1;
                    offset = 100;
                    needed = 8;
                }
                else if (status == 1) {
                    // record header
                    needed = data.getInt32(offset + 4) * 2;
                    offset += 8;
                    filesize -= 8;
                    status = 2;
                }
                else if (status == 2) {
                    // record contents
                    controller.enqueue(shpRecord(buffer, offset, project, withM));
                    offset += needed;
                    filesize -= needed;
                    needed = 8;
                    status = 1;
                } else
                    throw new Error('SHPTransform: bug');
            }
        },
        flush() {
            if (filesize != 0)
                throw new TypeError(`SHPTransform: readable bytes remained: ${filesize}.`);
        }
    });
}

/**
 * Returns TransformStream of records converted from a DBF Readable.
 * @param {string?} encoding of text fields in the records.
 * @returns TransformStream
 */
export function DBFTransform(encoding) {
    /** @type {ArrayBuffer | null} */
    let buffer = null;
    let offset = 0;     // current offset in the buffer
    let needed = 32;    // number of bytes required in the buffer
    let status = 0;
    let numrec = 0;
    let reclen = 0;
    const fields = [];
    //
    let decoder = new TextDecoder('latin1');
    if (encoding) {
        if (typeof encoding != 'string')
            throw new TypeError('DBFTransform: first arg: string expected.');
        decoder = new TextDecoder(encoding);
    }
    //
    return new TransformStream({
        transform(chunk, controller) {
            if (buffer == null)
                buffer = chunk.buffer;
            else {
                const rem = new Uint8Array(buffer.slice(offset));
                const tmp = new Uint8Array(rem.byteLength + chunk.buffer.byteLength);
                tmp.set(rem, 0);
                tmp.set(chunk, rem.byteLength);
                buffer = tmp.buffer;
                offset = 0;
            }
            while (true) {
                if (buffer.byteLength - offset < needed)
                    return;       // transform will be called with the next chunk
                if (status == 0) {
                    const header = dbfHeader(buffer);
                    numrec = header.numrec;
                    reclen = header.reclen;
                    offset = 32;
                    needed = 32;
                    status = 1;
                }
                else if (status == 1) {
                    // field descriptor
                    const pos = offset;
                    const field = dbfField(buffer, pos, decoder);
                    if (!field) {
                        status = 2;
                        needed = reclen;
                        offset += 1;
                        continue;
                    }
                    fields.push(field);
                    offset += needed;
                }
                else if (status == 2) {
                    const rec = new DataView(buffer, offset, reclen)
                    const flag = rec.getUint8(0);
                    if (flag == 0x2a) {
                        offset += needed;
                        --numrec;
                        continue;
                    }
                    if (flag != 0x20)
                        throw new TypeError('DBFTransform: format error.');
                    controller.enqueue(dbfRecord(rec, fields, decoder));
                    offset += needed;
                    --numrec;
                }
            }
        },
        flush() {
            if (numrec != 0)
                throw new TypeError(`DBFTransform: records remained: ${numrec}.`);
        }
    });
}

/**
 * Stitches two ReadableStreams together and yields Feature objects.
 * @param {ReadableStream} shp
 * @param {ReadableStream} dbf
 * @returns {AsyncGenerator<GeoJSON.Feature>}
 */
export async function* stitch(shp, dbf) {
    if (!(shp instanceof ReadableStream))
        throw new TypeError('stitch: first arg: not a ReadableStream');
    if (!(dbf instanceof ReadableStream))
        throw new TypeError('stitch: second arg: not a ReadableStream');
    const shp_reader = shp.getReader();
    const dbf_reader = dbf.getReader();
    while (true) {
        const feat = await shp_reader.read();
        const prop = await dbf_reader.read();
        if (feat.done && prop.done)
            break;
        if (feat.done)
            throw new TypeError('stitch: not enough feature records.');
        if (prop.done)
            throw new TypeError('stitch: not enough dbf records.');
        const feature = feat.value;
        feature.properties = prop.value;
        yield feature;
    }
}
