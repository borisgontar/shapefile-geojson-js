import { Map as GLMap, Popup } from 'maplibre-gl';
import { stitch, SHPTransform, DBFTransform } from './parser.js';

window.addEventListener('load', () => {
    const map = new GLMap({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'OSM': {
                    'tiles': [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    'scheme': 'xyz',
                    'type': 'raster',
                    'tileSize': 256
                }
            },
            layers: [
                { id: 'OSM', source: 'OSM', type: 'raster' }
            ],
            glyphs: './glyphs/{fontstack}/{range}.pbf',
            sprite: document.baseURI.replace(/[^/]*$/, '') + 'sprites/basic-v8',
        },
        attributionControl: false
    });
    map.flyTo({ center: [-125, 52], zoom: 6 });
    //
    const mapdiv = document.getElementById('map');
    mapdiv.ondragover = event => event.preventDefault();
    mapdiv.ondragend = event => {
        event.preventDefault();
        event.dataTransfer?.clearData();
    };
    mapdiv.ondrop = async event => {
        event.preventDefault();
        const dtr = event.dataTransfer;
        if (!dtr)
            return;
        if (dtr.files) {
            const files = [];
            for (let i = 0; i < dtr.files.length; i++)
                files.push(dtr.files[i]);
            const geo = await acceptFiles(files);
            if (geo)
                mkLayer(map, geo);
        }
    }
});

/**
 *
 * @param {GLMap} map
 * @param {GeoJSON.FeatureCollection} geo
 */
function mkLayer(map, geo) {
    map.addSource('src', {
        type: 'geojson',
        data: geo
    });
    map.addLayer({
        id: 'layer-symbol',
        type: 'symbol',
        source: 'src',
        layout: {
            'icon-image': 'marker-18',
            'icon-size': 1
        }
    });
    map.addLayer({
        id: 'layer-line',
        type: 'line',
        source: 'src',
        paint: {
            "line-width": 2
        }
    });
    map.addLayer({
        id: "layer-fill",
        type: "fill",
        source: "src",
        paint: {
            "fill-color": "gray",
            "fill-opacity": 0.25,
            "fill-outline-color": "blue"
        }
    });
    map.fitBounds(geo.bbox);
    //
    const lrid = 'layer-symbol';
    map.on('click', lrid, e => {
        if (!e.features)
            return;
        //const coordinates = e.features[0].geometry.coordinates.slice();
        // Ensure that if the map is zoomed out such that multiple
        // copies of the feature are visible, the popup appears
        // over the copy being pointed to.
        //while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        //    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        //}
        new Popup()
            .setLngLat(e.lngLat)
            .setHTML(mkPopup(e.features[0]))
            .addTo(map);
    });
    map.on('mouseenter', lrid, () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', lrid, () => {
        map.getCanvas().style.cursor = '';
    });
}

/** @param {File[]} files */
async function acceptFiles(files) {
    let shp = undefined;
    let dbf = undefined;
    let prj = '';
    for (const file of files) {
        const name = file.name;
        const j = name.lastIndexOf('.');
        const ext = j < 0 ? '' : name.substring(j + 1).toLowerCase();
        if (ext == 'shp') {
            if (shp)
                return alert('shp file already specified');
            shp = file;
        }
        else if (ext == 'dbf') {
            if (dbf)
                return alert('dbf file already specified');
            dbf = file;
        }
        else if (ext == 'prj') {
            if (prj)
                return alert('prj file already specified');
            prj = await loadText(file);
        }
    }
    if (!shp)
        return alert('shp file not specified');
    if (!dbf)
        return alert('dbf file not specified');

    const bbox = Array(4);
    const shpTransform = SHPTransform(bbox, prj);
    const dbfTransform = DBFTransform();
    try {
        const features = stitch(
            shp.stream().pipeThrough(shpTransform), dbf.stream().pipeThrough(dbfTransform)
        );
        const geo = {
            type: 'FeatureCollection',
            bbox: bbox,
            features: []
        };
        for await (const ft of features)
            geo.features.push(ft);
        return geo;
    } catch (err) {
        alert(err.message);
        return null;
    }
}

function loadText(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = err => reject(err);
        reader.onload = () => resolve(reader.result.toString());
        reader.readAsText(blob, 'utf8');
    });
}

/**
 * Returns HTML for Feature's popup.
 * @param {GeoJSON.Feature} ft
 */
function mkPopup(ft) {
    const cls = 'popup';
    const props = ft.properties;
    if (!props || Object.keys(props).length === 0)
        return ft.id?.toString() || '';    // nothing else available
    let want_hr = false;
    let html = `<div class="${cls}" style="background-color: white"><table class="${cls}-table">`;
    const name = escapeHTML(props._name_ || ft.id);
    if (name != undefined) {
        html += `<tr class="${cls}-row">` +
            `<td class="${cls}-title ${cls}-cell" colspan="2">${name}</td></tr>`;
        want_hr = true;
    }
    const desc = props._description_;
    if (desc) {
        html += `<tr class="${cls}-row">` +
            `<td class="${cls}-descr ${cls}-cell" colspan="2">${desc}</td></tr>`;
        want_hr = true;
    }
    for (const key of Object.keys(props).sort()) {
        let val = props[key];
        if (val === null)
            continue;
        if (key[0] == '_')
            continue;
        if (typeof val == 'object') {
            let div = '';
            for (const k of Object.keys(val).filter(k => k[0] != '_').sort())
                div += `<div>${k}: ${JSON.stringify(val[k])}</div>`;
            val = div;
        }
        if (want_hr) {
            html += `<tr class="${cls}-row"><td class="${cls}-name" colspan="2">` +
                '<hr style="margin: 0"></td></tr>';
            want_hr = false;
        }
        if (val !== '') {
            html += `<tr class="${cls}-row">` +
                `<td class="${cls}-name">${escapeHTML(key)}</td>` +
                `<td class="${cls}-value"><div class="${cls}-cell">` +
                `${val}</div></td></tr>`;
        }
    }
    html += '</table></div>';
    return html;
}

/**
 * Returns text with '<' replaced by '&lt;', etc.
 * @param {string} text
 */
export function escapeHTML(text) {
    if (text == undefined || text === '')
        return undefined;
    const str = '' + text;
    const match = /["'&<>]/.exec(str);
    if (!match)
        return str;
    let escape, html = '', index, lastIndex = 0;
    for (index = match.index; index < str.length; index++) {
        switch (str.charCodeAt(index)) {
            case 34: // "
                escape = '&quot;';
                break;
            case 38: // &
                escape = '&amp;';
                break;
            case 39: // '
                escape = '&#39;';
                break;
            case 60: // <
                escape = '&lt;';
                break;
            case 62: // >
                escape = '&gt;';
                break;
            case 96: // `
                escape = '&#96;';
                break;
            default:
                continue;
        }
        if (lastIndex !== index)
            html += str.substring(lastIndex, index);
        lastIndex = index + 1;
        html += escape;
    }
    return lastIndex != index ? html + str.substring(lastIndex, index) : html;
}
