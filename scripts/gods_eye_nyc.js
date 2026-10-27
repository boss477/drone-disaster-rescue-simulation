import * as Cesium from 'cesium';

// Actual streamed building geometry. Never substitute procedural scene buildings here.
export function installNewYork({application,el}){
  let viewer=null,tileset=null,config=null,source=null,assetId=null,loading=false,tileLoads=0,featuresLoaded=0;
  const views={downtown:{lon:-74.009,lat:40.708,range:2600},midtown:{lon:-73.986,lat:40.752,range:2700},city:{lon:-73.96,lat:40.735,range:32000}};
  function fly(){
    if(!viewer)return;const p=views[el('nycView').value];
    const height=viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(p.lon,p.lat))||0;
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(p.lon,p.lat,height),200),
      {offset:new Cesium.HeadingPitchRange(.25,-.55,p.range),duration:1.7});
  }
  async function load(requested='nyc'){
    if(loading)return;loading=true;el('nyc').disabled=true;el('nycSource').disabled=true;el('nycControls').hidden=false;
    el('nycStatus').textContent='Loading New York building geometry…';el('nycNotice').textContent='';
    try{
      await application.start();const components=application.getComponents();viewer=components.scene.viewer;
      // Keep the independent NYC/OSM data separate from Google's photorealistic map.
      await components.scene.mapStackController.setStack('esri-imagery');
      if(!config){const response=await fetch('/__rescue/nyc-config',{cache:'no-store'});if(!response.ok)throw Error('config');config=await response.json();}
      if(!config.access_token){el('nycStatus').textContent='Configure your Cesium ion token, then retry.';return;}
      const requestedId=requested==='nyc'?Number(el('nycAsset').value):config.fallback_asset_id;
      if(!Number.isSafeInteger(requestedId)||requestedId<1){el('nycStatus').textContent='Enter the positive numeric asset ID shown in your Cesium ion account.';return;}
      if(tileset && source===requested && assetId===requestedId){tileset.show=true;el('nycHide').textContent='Hide buildings';el('nycStatus').textContent=(source==='nyc'?'Curated NYC':'OSM building geometry · New York')+` · ${tileLoads} content tiles loaded`;fly();return;}
      let next,actual=requested;
      const options={maximumScreenSpaceError:14,cacheBytes:128*1024*1024,maximumCacheOverflowBytes:64*1024*1024};
      const fetchTiles=async id=>Cesium.Cesium3DTileset.fromUrl(await Cesium.IonResource.fromAssetId(id,{accessToken:config.access_token}),options);
      try{next=await fetchTiles(requestedId);}
      catch(error){
        if(requested!=='nyc')throw error;
        el('nycNotice').textContent='Curated NYC is unavailable to this token. Showing OSM building geometry in New York. Enable the curated asset in your ion account, then select it again.';
        next=await fetchTiles(config.fallback_asset_id);actual='osm';
      }
      if(tileset)viewer.scene.primitives.remove(tileset);
      tileset=viewer.scene.primitives.add(next);source=actual;assetId=source==='nyc'?requestedId:config.fallback_asset_id;tileLoads=0;featuresLoaded=0;
      tileset.style=new Cesium.Cesium3DTileStyle({color:"color('#d8d1bc')"});
      const label=source==='nyc'?'Curated New York City buildings':'OSM building geometry · New York';
      el('nycSource').value=source;el('nycHide').textContent='Hide buildings';
      el('nycStatus').textContent=label+' · streaming visible tiles…';
      tileset.tileLoad.addEventListener(tile=>{
        tileLoads++;featuresLoaded+=tile.content?.featuresLength || 0;
        el('nycStatus').textContent=`${label} · ${tileLoads} content tiles loaded · ${featuresLoaded} building features loaded`;
        viewer.scene.requestRender();
      });
      tileset.tileFailed.addEventListener(()=>{el('nycStatus').textContent=label+' · a tile failed; check the connection or token permissions.';});
      fly();viewer.scene.requestRender();
    }catch{el('nycStatus').textContent='Cannot load building tiles. Check your Cesium token, asset access and connection, then retry.';}
    finally{loading=false;el('nyc').disabled=false;el('nycSource').disabled=false;}
  }
  el('nyc').onclick=()=>load(el('nycSource').value);
  el('nycSource').onchange=()=>load(el('nycSource').value);
  el('nycView').onchange=fly;
  el('nycHide').onclick=()=>{
    if(!tileset)return;
    if(!tileset.show && application.getComponents().scene.mapStackController.getState().activeId==='photoreal'){load(source);return;}
    tileset.show=!tileset.show;el('nycHide').textContent=tileset.show?'Hide buildings':'Show buildings';
    viewer.scene.requestRender();
  };
  addEventListener('gev:map-stack-changed',event=>{
    if(event.detail?.activeId==='photoreal' && tileset?.show){
      tileset.show=false;el('nycHide').textContent='Show buildings';
      el('nycStatus').textContent='Independent NYC/OSM layer hidden while Google photorealistic imagery is active.';
    }
  });
  addEventListener('pagehide',()=>{if(tileset && viewer && !viewer.isDestroyed())viewer.scene.primitives.remove(tileset);},{once:true});
  // Read-only acceptance hook exposes counts and source, never the access token.
  const api={getState:()=>({source,assetId,loading,tileLoads,featuresLoaded,visible:!!tileset?.show,view:el('nycView').value})};
  window.RescueNewYork=api;
  if(new URLSearchParams(location.search).get('nyc')==='1')load('nyc');
  return api;
}
