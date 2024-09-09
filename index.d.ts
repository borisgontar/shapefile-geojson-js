import { Feature } from "geojson";

declare module 'shapefile-geojson-js' {
    export function SHPTransform(bbox?: number[], prjwkt?: string, withM?: boolean): TransformStream;
    export function DBFTransform(encoding?: string): TransformStream;
    export async function* stitch(shp: ReadableStream, dbf: ReadableStream):
        AsyncGenerator<Feature>;
}
