import {test} from 'node:test';
import assert from 'node:assert/strict';
import {greatCircleRoute} from '../scripts/city_route_math.mjs';
const point=(lat,lon)=>({latitude:lat*Math.PI/180,longitude:lon*Math.PI/180,height:0});
test('local destination preserves exact endpoints and finite intermediate coordinates',()=>{
  const a=point(40.6937,-73.7814),b=point(40.695,-73.779),route=greatCircleRoute(a,b);
  assert.deepEqual(route.points[0],a);assert.deepEqual(route.points.at(-1),b);
  assert.ok(route.surfaceDistance>100&&route.surfaceDistance<500);
  assert.ok(route.points.every(p=>Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)));
});
test('date-line crossing takes the short arc',()=>{
  const route=greatCircleRoute(point(0,179),point(0,-179));
  assert.ok(route.surfaceDistance>220000&&route.surfaceDistance<224000);
  assert.ok(route.points.every(p=>Math.abs(p.longitude)>3));
});
test('antipodal and polar destinations remain finite',()=>{
  for(const [a,b]of [[point(0,0),point(0,180)],[point(90,0),point(-90,0)],[point(0,0),point(0,0)]]){
    const route=greatCircleRoute(a,b);
    assert.ok(route.points.every(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)));
    assert.deepEqual(route.points.at(-1),b);
  }
});
