import Airtable from "airtable";
import fs from "fs";
import "dotenv/config";
import { slugify } from "./html.js";
import { marked } from "marked";
import * as turf from "@turf/turf";

import airtableAPI, { Bases, jsonify } from "./airtable.js";

const base = new Airtable({
  apiKey: process.env.AIRTABLE_TOKEN
}).base(process.env.AIRTABLE_BASE_ID)


const data = {
  facilities: [

  ]
}

export const EchoStatus = {
  VALID: "Valid",
  VIOLATION: "Violation",
  TERMINATED: "Terminated"
}

// Fetch an entire Airtable table once, following offset pagination.
// Returns a Map keyed by record id so linked records can be hydrated in memory
// instead of one HTTP request per linked id.
async function getTableById( table ) {
  const records = new Map();
  let offset;

  do {
    const query = offset ? `?offset=${encodeURIComponent(offset)}` : "";
    const page = await airtableAPI.get( `${encodeURIComponent(table)}${query}` );
    for( const record of page.records ) records.set( record.id, record );
    offset = page.offset;
  } while( offset );

  return records;
}


function getDEPData( ids, table ) {
  return ids
    .map( id => table.get(id) )
    .filter( Boolean )
    .map( record => jsonify(record) );
}


function getECHOData( ids, table ) {
  return ids
    .map( id => table.get(id) )
    .filter( Boolean )
    .map( record => {
      const json = jsonify(record);
      delete json.name;
      delete json.facility;
      return json;
    });
}


function getAttachments( ids, table ) {
  return ids
    .map( id => table.get(id) )
    .filter( Boolean )
    .map( record => jsonify(record) );
}


function recordToFacility(record, tables) {
  const facility = jsonify(record);

  console.log( `🏭 ${facility.company_name.trim()}`);

  facility.slug = slugify(facility.company_name);

  if( facility.attachments ) {
    console.log(`  📎 Hydrating attachments from Airtable...`);
    facility.attachments = getAttachments(facility.attachments || [], tables.attachments);
  }

  if( facility.echo_compliance ) {
    console.log(`  📋 Hydrating compliance data from EPA...`);
    facility.echo_compliance = getECHOData( facility.echo_compliance, tables.echo );
  }

  if( facility.dep_violations ) {
    console.log(`  🚨 Hydrating violation info from DEP...`);
    const dep = getDEPData( facility.dep_violations, tables.dep );
    facility.dep_violations = {
      violation_count: dep.at(0)?.violation_count,
      since: dep.at(0)?.since
    }
  }

  if( facility.clean_air_notes ) {
    facility.clean_air_notes = marked.parse(facility.clean_air_notes);
    console.log(`  ✏️  Rendering Clean Air Notes to HTML...`);
  }

  if( facility.notes ) {
    facility.notes = marked.parse(facility.notes);
    console.log(`  ✏️  Rendering Facility Notes to HTML...`);
  }

  if( facility.echo_compliance?.length > 0 && facility.echo_compliance.some( permit => permit.status == EchoStatus.VIOLATION ) )
    facility.alert = true;

  if( facility.echo_compliance?.length > 0 ) {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    });

    const totalPenalties = facility.echo_compliance.reduce( (sum, permit) => sum + permit.penalties, 0 );
    if (totalPenalties > 0 )
      facility.totalPenalties = formatter.format( totalPenalties );
  }

    delete facility.attachments_old;

  return facility;
}

function produceMapData( data ) {
  console.log("🗺️  Producing map data...")

  const points = turf.featureCollection( data.facilities.map( facility => turf.point([ facility.longitude, facility.latitude ])));
  const bounds = turf.bbox(points);

  const result = {
    map: {
      bounds
    },
    facilities: data.facilities.map( ({company_name, latitude, longitude, alert, slug})=> ({company_name, latitude, longitude, alert, slug }))
  }

  return result;
}

async function getFacilities() {
  const records = [];
  await base('Facilities').select().eachPage( (page, fetchNextPage) => {
    records.push( ...page );
    fetchNextPage();
  });
  return records;
}


console.log( "✈️  Querying Airtable...")

const [ facilities, attachments, echo, dep ] = await Promise.all([
  getFacilities(),
  getTableById( Bases.ATTACHMENTS ),
  getTableById( Bases.ECHO ),
  getTableById( Bases.DEP ),
]);

const tables = { attachments, echo, dep };

data.facilities = facilities.map( record => recordToFacility(record, tables) );
data.facilities.sort((a, b) => a.company_name.toLowerCase() < b.company_name.toLowerCase() ? -1 : 1 );

console.log( "💾 Writing data.json...")
fs.writeFileSync("./src/data/data.json", JSON.stringify( data, null, 2 ));

const mapData = produceMapData(data);
console.log( "💾 Writing map-data.json...")
fs.writeFileSync("./src/data/map-data.json", JSON.stringify( mapData ));

console.log("✅ Done!")
