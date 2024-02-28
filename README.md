# shapefile-geojson-node

Streaming ESRI Shapefile parser.

This module reads a stream in the [ESRI Shapefile](https://www.esri.com/content/dam/esrisites/sitecore-archive/Files/Pdfs/library/whitepapers/pdfs/shapefile.pdf)
format and transorms it into a stream of
[GeoJSON](https://datatracker.ietf.org/doc/html/rfc7946) Feature objects
containing source geometries. If a projection data is provided,
the geometry coordinates are replaced by the WGS84 longitudes and latitudes.
If an accompanying stream in [dBASE](https://en.wikipedia.org/wiki/.dbf) format is provided,
it is used to populate feature properties.

The module works both under Node.js and in the browser environment.
It uses the [WHATWG streams](https://streams.spec.whatwg.org)
which were finalized in Node.js just recently (2024), so Node version 21
is recommended.

The generated GeoJSON is as valid as the source data.
In particular the module relies on the correct winding order
of polygon outer rings and holes.

The generated GeoJSON is fully compliant with RFC7946, including corrent
winding order of polygon rings and antimeridian cutting.
Shapefile's records with null shape are transformed into
features with null geometries.

For a command line converter, go [here](#command-line-tool).

## Examples for Node.js

If the shapefiles (shp, dbf and prj) are local files,
just use their paths to create input streams and call `stitch` like this:
```js
import { createSHPStream } from 'shapefile-geojson-js';
import { createReadStream, readFileSync } from 'node:fs';

// get ReadableStreams for local files
const shpStream = ReadableStream.from(createReadStream('path-to-file.shp'));
const dbfstream = ReadableStream.from(createReadStream('path-to-file.dbf'));

// load the projection information
const prjwkt = readFileSync('path-to-file.prj', 'utf8');
const encoding = 'windows-1252'    // or whatever the dbf texts are in
const bbox = Array(4);             // will be filled with the actual values

// these functions return TransformStreams
const shpTransform = SHPTransform(bbox, prjwkt);
const dbfTransform = DBFTransform(args.encoding);

// pipe the data into them and stitch them together
const features = stitch(
    shpstream.pipeThrough(shpTransform),
    dbfstream.pipeThrough(dbfTransform));

// now you can get the Features one by one
for await (const feature of features)
    console.log(JSON.stringify(feature));
```
As soon as `shpTransform` gets data from the pipe it fills
`bbox` with the actual values.

If there is no dbf (or it's not needed), read features directly
from the first pipe:
```js
const features = shpstream.pipe(new SHPTransform(prjwkt));
for await (let feature of features)
    console.log(JSON.stringify(feature));
```

## Installation

```sh
npm install shapefile-geojson-js
```

## Usage

The module exports two classes.

Class **SHPTransform** is a
[Transformer](https://nodejs.org/dist/latest-v21.x/docs/api/stream.html#class-streamtransform)
stream which reads its input in the shapefile format and writes out
GeoJSON Feature objects.
```js
new SHPTransform(projection, options);
```
* `projection` - the coordinate projection used in the shapefile. Should be
a string in the projection WKT format (usually the contents of the
accompanying .prj file) or a projection name like 'EPSG:3857'.
See [PROJ4](https://github.com/proj4js/proj4js) for more information.
If not specified, the coordinates are not altered.

* `options` - additional options passed to the `Transform` constructor
from `node:stream`. Usually not specified.

This class is intended for use in a pipeline like this:
```js
const stream = createReadStream('path-to-file.shp');
const shapes = new SHPTransform(projection);
for await (const feature of stream.pipe(shapes)) {
    do-something(feature);
}
```
There is also a getter `SHPTransform.bbox` which returns the bounding box
of all features of the shapefile. Note that it will not be available
until at least one feature is read from the pipe.

Class **DBFTransform** is a Transformer stream which reads its input in the
[DBF](https://en.wikipedia.org/wiki/.dbf) format and writes out
objects representing the table rows.
```js
new DBFTransform(encoding, options);
```
* `encoding` - name of encoding used in the text fields of the DBF records.
By default 'latin1' is used.
* `options` - additional options passed to the `Transform` constructor
from `node:stream`. Usually not specified.

This class is intended to use in the same way as the SHPTransform class.
```js
const stream = createReadStream('path-to-file.dbf');
const records = new DBFTransform();
for await (const record of stream.pipe(records)) {
    do-something(record);
}
```

The module also exports an async generator function **stitch**
which reads both SHP and DBF streams and stiches them together,
generating GeoJSON Feature objects with their type and
geometries taken from the first stream and properties
taken from the second one.
```js
async function* stitch(shp, dbf);
```
* `shp` - a read stream in the Shapefile format piped into a SHPTransform
instance.
* `dbf` - a read stream in the DBF format piped into a DBFTransform
instance.

## Command line tool

The project directory contains `shp2json.js`, a Node.js script to
convert Shapefiles to GeoJSON. Run `./shp2json -h` to see its
"usage" message:
```
  -i, --input      Path to input files (without extension)
  -o, --output     Path to output file, stdout by default
  -n, --ndjson     Output newline-delimited Feature records only
      --decimals   Precision of coordinates in the output, 6 by default
      --encoding   Text fields enconding in DBF file, latin1 by default
      --limit      Max number of features to accept, skip the rest
      --start      Number of features to skip at the beginnning
  -h, --help       Show this help and exit
      --version    Show version number and exit
```
The option `--input` expects path to the input `.shp` file and expects
the (optional) `.dbf` and `.prj` files in the same directory.
The `.shp` extension can be omitted.

By default this utility produces a GeoJSON
FeatureCollection output. If `--ndjson` is specified, only newline-delimited
Feature records are written, which is certainly not a valid JSON.

Options `--start` and `--limit` allow to skip a number of staring features
and limit the number of produced features.

## Notes

* The module relies on correct winding order of polygon outer rings and holes
in the source data. But there may by more than one outer ring
and there is no other way to determine which hole belongs to which outer ring
but to test them for intersection.

The resulting GeoJSON polygons follow the RFC7946 - exterior rings are
counterclockwise and holes are clockwise.

* Shapefile records with no coordinates are presented as
```js
{ type: 'Feature', geometry: null }
```

* When parsing DBF, numeric fields with empty or non-numeric contents
are presented as `null`. Logical fields with contents [YyTt]
are presented as `true`, with [NnFf] - as `false`, otherwise as `null`.

* Shapefile records of 'Z' and 'M' types are not implemented.

* Only dBase format level 5 without encryption is implemented.

* This module's functions will throw a `TypeError` if used incorrectly
(e.g. the first parameter of createSHPStream is not a Readable)
or if the streams are not in the correct format. If the generic
`Error` is thrown it's most probably a bug.
