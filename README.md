# shapefile-geojson-js

Streaming ESRI Shapefile parser.

This module reads a stream in the [ESRI Shapefile](https://www.esri.com/content/dam/esrisites/sitecore-archive/Files/Pdfs/library/whitepapers/pdfs/shapefile.pdf)
format and transorms it into a stream of
[GeoJSON](https://datatracker.ietf.org/doc/html/rfc7946) Feature objects
containing source geometries. If a projection data is provided,
the geometry coordinates are replaced by longitudes and latitudes.
If an accompanying stream in [dBASE](https://en.wikipedia.org/wiki/.dbf) format is provided,
it is used to populate feature properties.

The module works both under Node.js and in the browser environment.
It uses the [WHATWG streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
which were finalized in Node.js just recently (2024), so Node version 21
is recommended.

The generated GeoJSON reproduces the source data and is as valid as the data is.
There are two exceptions:
* Reprojecting to longitudes and latitudes
may cause, for example, longitudes slighly bigger than 180.
* Polygon inner ring, if its outer ring not found, will become
an outer ring itself.

For a command line converter, go [here](#command-line-tool).

## Examples

First, create ReadableStreams for your data:
```js
const shpStream = // get ReadableStream somehow;
const dbfStream = // get ReadableStream somehow;
```
You need to know the projection of coordinates stored in the SHP
data and encoding of the text fields of the DBF records:
```js
const prjwkt = 'EPSG:3857';       // not needed if SHP has longitudes and latitudes
const encoding = 'windows-1251';  // default is 'latin1'
```
Pipe the data into the module's transform streams
and stitch them together like this:
```js
import { DBFTransform, SHPTransform, stitch } from 'shapefile-geojson-js';
const bbox = Array(4);    // will be filled by actual values
const features = stitch(
    shpStream.pipeThrough(SHPTransform(bbox, prjwkt),
    dbfStream.pipeThrough(DBFTransform(encoding)));
```
Now you can get the Features one by one:
```js
for await (const feature of features)
    console.log(JSON.stringify(feature));
```
If there is no DBF data, you can omit stitching:
```js
const features = shpStream.pipeThrough(SHPTransform(bbox, prjwkt);
```

Creating the ReadableStreams depends on your environment and on
location of the data. In Node.js getting the data from local files
looks like this:
```js
import { createReadStream, readFileSync } from 'node:fs';
const shpStream = ReadableStream.from(createReadStream('path-to-file.shp'));
const dbfstream = ReadableStream.from(createReadStream('path-to-file.dbf'));
const prjwkt = readFileSync('path-to-file.prj', 'utf8');
```
If the data is on the network, you can `fetch` it:
```js
const shpStream = await fetch('url-of-shp').then(res => res.body);
```
In the browser environment you need to get a `File` (or `Blob`) object representing
the data. Let the user choose the files using the system file chooser
(\<input type="file"\>) or handle the `ondrop` event to allow the user
to drag and drop files into the window. Then:
```js
const shpStream = file.stream();   // file instanceof File
```

## Installation

```sh
npm install shapefile-geojson-js
```

## Usage

The module exports three functions.

Function  **SHPTransform** returns a TransformStream of features
converted from a SHP ReadableStream. The writable side of this TransformStream
receives GeoJSON Feature objects.
```js
SHPTransform(bbox, projection);
```
* `bbox` - (optional) array to be filled by the bounding box of the entire
FeatureCollection received from the data.
* `projection` - (optional) the coordinate projection used in the shapefile.
Should be a string in the projection WKT format
(usually the contents of the accompanying .prj file)
or a projection name like 'EPSG:3857'.
See [PROJ4](https://github.com/proj4js/proj4js) for more information.
If not specified, the coordinates are not altered.

This function is intended for use in a pipeline like this:
```js
const shpStream = ReadableStream.from(createReadStream('path-to-file.shp'));
const features = shpStream.pipeThrough(SHPTransform(bbox, prjwkt));
```

Function **DBFTransform** returns a TransformStream of records
converted from its input in the [DBF](https://en.wikipedia.org/wiki/.dbf) format
and writes out objects representing the table rows.
```js
DBFTransform(encoding);
```
* `encoding` - name of encoding used in the text fields of the DBF records.
By default 'latin1' is used.

This function is intended to use the same way as the SHPTransform.
```js
const dbfStream = ReadableStream.from(createReadStream('path-to-file.dbf'));
const records = dbfStream.pipeThrough(DBFTransform(encoding));
```

The module also exports an async generator function **stitch**
which reads both SHP and DBF streams and stiches them together,
generating GeoJSON Feature objects with their type and
geometries taken from the first stream and properties
taken from the second one.
```js
async function* stitch(shp, dbf);
```
* `shp` - a ReadableStream from the pipe into a SHP TransformStream.
* `dbf` - a ReadableStream from the pipe into a DBF TransformStream.

## Command line tool

The project directory contains `shp2json.js`, a Node.js script to
convert Shapefiles to GeoJSON. Run `./shp2json. js -h` to see its
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
in the source data. If there is more than one outer ring
the module tries to determine which hole belongs to which outer ring
by testing them for intersection.

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
