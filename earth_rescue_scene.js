/* Local 3D presentation geometry for the simulated rescue mission. */
const RescueScene = (() => {
  async function terrainProfile(viewer, base, target) {
    const points = Array.from({ length: 13 }, (_, index) => Cesium.Cartographic.fromDegrees(
      base.lon + (target.lon - base.lon) * index / 12,
      base.lat + (target.lat - base.lat) * index / 12,
    ));
    let sampled = false;
    if (viewer.terrainProvider?.availability) {
      let timer;
      try {
        await Promise.race([
          Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, points),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('terrain timeout')), 8000); }),
        ]);
        sampled = points.every(point => Number.isFinite(point.height));
      } catch (_) { /* Fall back to the terrain tiles currently loaded in the view. */ }
      finally { clearTimeout(timer); }
    }
    return {
      base: { ...base }, target: { ...target }, sampled,
      heights: points.map(point => Number.isFinite(point.height) && sampled
        ? point.height : (viewer.scene.globe.getHeight(point) ?? 0)),
    };
  }

  function groundHeight(profile, position) {
    if (!profile) return 0;
    const dy = profile.target.lat - profile.base.lat;
    const dx = profile.target.lon - profile.base.lon;
    const length = dx * dx + dy * dy;
    const fraction = length ? Math.max(0, Math.min(1,
      ((position.lon - profile.base.lon) * dx + (position.lat - profile.base.lat) * dy) / length)) : 0;
    const index = fraction * (profile.heights.length - 1);
    const low = Math.floor(index), high = Math.min(low + 1, profile.heights.length - 1);
    return profile.heights[low] + (profile.heights[high] - profile.heights[low]) * (index - low);
  }

  function worldPosition(profile, position, msl = null) {
    return Cesium.Cartesian3.fromDegrees(position.lon, position.lat,
      Number.isFinite(msl) ? msl : groundHeight(profile, position) + position.alt);
  }

  function offset(origin, east, north) {
    return { lat: origin.lat + north / 111320,
      lon: origin.lon + east / (111320 * Math.max(0.01, Math.cos(origin.lat * Math.PI / 180))) };
  }

  function addSite(viewer, base, target, profile, flooded) {
    const entities = [];
    const add = options => {
      // Keep this small training scene on Cesium's synchronous geometry path;
      // remote worker-module downloads must not delay the rescue objects.
      if (options.position) {
        const position = options.position;
        options.position = new Cesium.CallbackProperty(() => position, false);
      }
      if (options.polygon) {
        const hierarchy = new Cesium.PolygonHierarchy(options.polygon.hierarchy);
        options.polygon.hierarchy = new Cesium.CallbackProperty(() => hierarchy, false);
      }
      const entity = viewer.entities.add(options);
      entities.push(entity);
      return entity;
    };
    const at = (position, alt) => worldPosition(profile, { ...position, alt });
    add({ position: at(base, 0.3), ellipse: { semiMajorAxis: 15, semiMinorAxis: 15,
      height: groundHeight(profile, base) + 0.3, material: Cesium.Color.fromCssColorString('#244a4c') },
      label: { text: 'H · AID BASE', font: 'bold 14px sans-serif', fillColor: Cesium.Color.CYAN,
        pixelOffset: new Cesium.Cartesian2(0, -24), disableDepthTestDistance: Infinity } });
    if (flooded) {
      const corners = [[-105, -65], [105, -65], [105, 95], [-105, 95]].map(([x,y]) => offset(target, x, y));
      add({ polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(corners.flatMap(p => [p.lon,p.lat])),
        height: groundHeight(profile, target) + 2.5,
        material: Cesium.Color.fromCssColorString('#158ac3').withAlpha(0.65) } });
    }
    [[0,0],[-65,25],[65,30],[-55,-35],[55,-30]].forEach(([x,y], index) => {
      const center = offset(target, x, y);
      add({ position: at(center, 5), box: { dimensions: new Cesium.Cartesian3(24,20,10),
        material: Cesium.Color.fromCssColorString(index ? '#b3a691' : '#d4d9d2') } });
      add({ position: at(center, 10.5), box: { dimensions: new Cesium.Cartesian3(27,23,1),
        material: Cesium.Color.fromCssColorString(index ? '#9b6255' : '#486476') } });
    });
    const roof = 11;
    [-5,0,5].forEach((x, index) => {
      const center = offset(target, x, 3);
      add({ position: at(center, roof + 1.2), ellipsoid: { radii: new Cesium.Cartesian3(0.7,0.5,1.2),
        material: Cesium.Color.fromCssColorString(index === 1 ? '#ffca60' : '#f37b63') } });
      add({ position: at(center, roof + 2.9), ellipsoid: { radii: new Cesium.Cartesian3(0.6,0.6,0.6),
        material: Cesium.Color.fromCssColorString('#f1c298') } });
    });
    add({ position: at(offset(target, 0, -5), roof + 0.1), ellipse: { semiMajorAxis: 4, semiMinorAxis: 4,
      height: groundHeight(profile, target) + roof + 0.1,
      material: Cesium.Color.LIME.withAlpha(0.6) } });
    return entities;
  }

  function addDrone(viewer, position, clock) {
    const body = viewer.entities.add({ position,
      viewFrom: new Cesium.Cartesian3(90, -130, 90),
      box: { dimensions: new Cesium.Cartesian3(3,5,1.8), material: Cesium.Color.fromCssColorString('#eff7fa') },
      point: { pixelSize: 8, color: Cesium.Color.CYAN },
      label: { text: 'RESCUE 01 · SIMULATED', font: 'bold 11px sans-serif', fillColor: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0,-26), disableDepthTestDistance: Infinity },
    });
    const parts = [];
    const relativePosition = (x,y,z) => new Cesium.CallbackProperty((time, result) => {
      const anchor = body.position.getValue(time);
      return Cesium.Matrix4.multiplyByPoint(Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
        new Cesium.Cartesian3(x,y,z), result || new Cesium.Cartesian3());
    }, false);
    [[10,1.4,0.7],[1.4,10,0.7]].forEach(dimensions => {
      parts.push(viewer.entities.add({ position: relativePosition(0,0,0),
        box: { dimensions: new Cesium.Cartesian3(...dimensions), material: Cesium.Color.fromCssColorString('#203740') } }));
    });
    [[-4,-4],[-4,4],[4,-4],[4,4]].forEach(([x,y]) => {
      const rotor = relativePosition(x,y,0.8);
      parts.push(viewer.entities.add({ position: rotor,
        ellipsoid: { radii: new Cesium.Cartesian3(2.6,2.6,0.08), material: Cesium.Color.CYAN.withAlpha(0.25) } }));
      parts.push(viewer.entities.add({ position: rotor,
        orientation: new Cesium.CallbackProperty(time => Cesium.Transforms.headingPitchRollQuaternion(
          rotor.getValue(time), new Cesium.HeadingPitchRoll(clock() * 24,0,0)), false),
        box: { dimensions: new Cesium.Cartesian3(5,0.4,0.12), material: Cesium.Color.fromCssColorString('#8cffff') } }));
    });
    return { body, parts };
  }
  return { terrainProfile, groundHeight, worldPosition, addSite, addDrone };
})();
