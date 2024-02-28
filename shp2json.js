#!/usr/bin/env node

import { DBFTransform, SHPTransform, stitch } from './parser.js';
import { createReadStream, readFileSync, existsSync, createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';

let decimals = 6;    // for coords formatting
let limit = 1000000000;
let start = 0;
let output = process.stdout;

const usage = `
Shapefile to GeoJSON converter.
Options:
  -i, --input      Path to input files (without extension)
  -o, --output     Path to output file, stdout by default
  -n, --ndjson     Output newline-delimited Feature records only
      --decimals   Precision of coordinates in the output, 6 by default
      --encoding   Text fields enconding in DBF file, latin1 by default
      --limit      Max number of features to accept, skip the rest
      --start      Number of features to skip at the beginnning
  -h, --help       Show this help and exit
      --version    Show version number and exit
`;

const { args } = (() => {
    try {
        const { values } = parseArgs({
            options: {
                input: { type: 'string', short: 'i' },
                output: { type: 'string', short: 'o' },
                ndjson: { type: 'boolean', short: 'n', default: false },
                decimals: { type: 'string' },
                encoding: { type: 'string' },
                limit: { type: 'string' },
                start: { type: 'string' },
                help: { type: 'boolean', short: 'h' },
                version: { type: 'boolean' }
            },
            allowPositionals: false,
            strict: true
        });
        if (values.help) {
            console.log(usage);
            process.exit(0);
        }
        if (values.version) {
            version();
            process.exit(0);
        }
        return { args: values };
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
})();

if (!args.input)
    quit('Input files not specified\n' + usage);
if (args.input.endsWith('.shp') || args.input.endsWith('.SHP'))
    args.input = args.input.substring(0, args.input.length - 4);

if (args.output) {
    try {
        output = createWriteStream(args.output, 'utf-8');
    } catch (err) {
        quit(err.message);
    }
}

if (args.decimals) {
    if (args.decimals.match(/^[1-9][0-9]*$/))
        decimals = Number(args.decimals);
    else
        quit(`Option ${args.decimals} invalid`);
}

if (args.limit) {
    if (args.limit.match(/^[1-9][0-9]*$/))
        limit = Number(args.limit);
    else
        quit(`Option ${args.limit} invalid`);
}

if (args.start) {
    if (args.start.match(/^[1-9][0-9]*$/))
        start = Number(args.start);
    else
        quit(`Option ${args.start} invalid`);
}

const shpstream = (() => {
    try {
        let fn = args.input + '.shp';
        if (!existsSync(fn))
            fn = args.input + '.SHP';
        if (!existsSync(fn))
            quit(`shp file not found`);
        return ReadableStream.from(createReadStream(fn));
    } catch (err) {
        quit(err.message);
    }
})();

const dbfstream = (() => {
    try {
        let fn = args.input + '.dbf';
        if (!existsSync(fn))
            fn = args.input + '.DBF';
        if (existsSync(fn))
            return ReadableStream.from(createReadStream(fn));
        console.log(`note: no dbf file`);
        return null;
    } catch (err) {
        quit(err.message);
    }
})();

const prjwkt = (() => {
    try {
        let fn = args.input + '.prj';
        if (!existsSync(fn))
            fn = args.input + '.PRJ';
        if (existsSync(fn))
            return readFileSync(fn, 'utf-8');
        console.log(`note: no prj file`);
        return null;
    } catch (err) {
        quit(err.message);
    }
})();

const bbox = Array(4);
const shpTransform = SHPTransform(bbox, prjwkt);
const dbfTransform = DBFTransform(args.encoding);

const features = dbfstream
    ? stitch(shpstream.pipeThrough(shpTransform), dbfstream.pipeThrough(dbfTransform))
    : shpstream.pipeThrough(shpTransform);

const nd = args.ndjson;
let first = true;
let count = 0;
for await (const feature of features) {
    count += 1;
    if (count <= start)
        continue;
    if (count > start + limit)
        break;
    if (!nd) {
        if (first) {
            const bb = JSON.stringify(bbox, fmt);
            output.write(`{"type": "FeatureCollection", "bbox": ${bb}, "features": [\n`);
        } else
            output.write(',\n');
    }
    first = false;
    check(feature);
    output.write(JSON.stringify(feature, fmt));
    if (nd)
        output.write('\n');
}
if (!nd)
    output.write('\n]}\n');
output.end();

function fmt(k, v) {
    return typeof v == 'number' ? Number(v.toFixed(decimals)) : v;
}

function version() {
    let version = 'unknown';
    try {
        const url = new URL('./package.json', import.meta.url);
        const pkg = JSON.parse(readFileSync(url, 'utf-8'));
        version = pkg.version;
    } catch (err) {
        console.error('Installation problem: package.json missing or corrupted.');
    }
    console.log(`App version: ${version}, Node: ${process.versions.node}`);
}

function quit(msg) {
    console.error(msg);
    process.exit(1);
}

function check(ft) {
    if (ft.bbox) {
        let [w, s, e, n] = ft.bbox;
        if (w < -180 || w > 180 || e < -180 || e > 180)
            console.log(ft.properties);
        if (s < -90 || s > 90 || n < -90 || n > 90)
            console.log(ft.properties);
    }
}
