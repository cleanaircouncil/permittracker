import Permit from "./permit.js";
import Map from "./map.js";
import { renderHTML } from "./html.js";

async function initData() {
  const response = await fetch("data/data.json");
  const data = await response.json();
  return data;
}

function initMap() {
  const map = new maplibregl.Map({
    container: 'map', // container id
    style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=v64Bpd9Og2E4Zm916XUB', // style URL
    center: [-75.165222, 39.952583],
    zoom: 9 // starting zoom
  });

  return map;
}

function initMarkers(map, data) {
  data.permits?.forEach( permit => {
    const marker = new maplibregl.Marker();
    marker.setLngLat( [permit.longitude, permit.latitude] );
    marker.addTo(map);
  })
}


async function init() {
  const map = initMap(); 

  const data = await initData();

  const permits = data.permits?.map( permit => Permit({permit}) );

  
  const display = document.getElementById("display");
  // render( permits, display );

  display.append( ...permits.map(renderHTML) );

  initMarkers(map, data);
}


document.addEventListener("DOMContentLoaded", init);