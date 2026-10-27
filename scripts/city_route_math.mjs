// Great-circle coordinates for a visual Earth flight, including date-line and
// antipodal destinations. This does not perform airspace or obstacle planning.
export function greatCircleRoute(start,end,segments=128){
  const vector=p=>[Math.cos(p.latitude)*Math.cos(p.longitude),Math.cos(p.latitude)*Math.sin(p.longitude),Math.sin(p.latitude)];
  const a=vector(start),b=vector(end),dot=Math.max(-1,Math.min(1,a.reduce((s,v,i)=>s+v*b[i],0)));
  const angle=Math.acos(dot);let tangent=b.map((v,i)=>v-dot*a[i]);
  let norm=Math.hypot(...tangent);
  if(norm<1e-10){
    tangent=Math.abs(a[2])<.9?[-a[1],a[0],0]:[0,-a[2],a[1]];norm=Math.hypot(...tangent);
  }
  tangent=tangent.map(v=>v/norm);
  const points=Array.from({length:segments+1},(_,i)=>{
    const theta=angle*i/segments,v=a.map((x,j)=>x*Math.cos(theta)+tangent[j]*Math.sin(theta));
    return {latitude:Math.asin(Math.max(-1,Math.min(1,v[2]))),longitude:Math.atan2(v[1],v[0]),height:0};
  });
  points[0]={...start};points[segments]={...end};
  return {points,surfaceDistance:angle*6371008.8};
}
