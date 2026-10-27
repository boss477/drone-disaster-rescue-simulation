(() => {
  const context=RescueHandoff.fromURL();
  window.fictionalMissionContext=context;
  const container=document.getElementById('reportContext');
  function line(text){const p=document.createElement('p');p.textContent=text;container.append(p);}
  if(context){
    document.getElementById('contextSummary').textContent='Report context · fictional exercise';
    line(context.title);
    line(`${context.feed || 'Operator placement'} · ${context.location.lat.toFixed(5)}, ${context.location.lon.toFixed(5)}`);
    if(context.reported_at)line(`Report time: ${context.reported_at}. Reports may be delayed.`);
    if(context.retrieved_at)line(`Retrieved: ${context.retrieved_at}`);
    if(context.sources[0]){const a=document.createElement('a');a.textContent='Original report ↗';a.href=context.sources[0].url;a.target='_blank';a.rel='noopener';container.append(a);}
    const w=context.weather;
    if(w)line(`Open-Meteo snapshot: ${w.temperature ?? '?'} °C · wind ${w.wind ?? '?'} km/h · rain ${w.rain ?? '?'} mm · ${w.time || 'observation time unknown'} · retrieved ${w.retrieved_at || 'unknown'}`);
    else line('No weather snapshot attached. View current weather in the Earth dashboard.');
    if(context.review)line(`AI estimate: ${context.review.category || 'unavailable'} · possible people ${context.review.people_count ?? 'unavailable'} · ${context.review.timestamp || 'time unknown'}. Image geolocation unverified; scene still uses three fictional recipients.`);
    line('Harbour Ward is an invented set, not the reported location or current damage.');
    document.getElementById('hazard').value=['fire','storm'].includes(context.kind)?context.kind:'flood';
    document.getElementById('aiView').href='earth_rescue.html?'+new URLSearchParams({lat:context.location.lat,lon:context.location.lon,name:context.title})+'#visionPanel';
  }else line('Standalone fictional training. No real incident, weather or AI results are attached.');
  document.getElementById('godView').href=RescueHandoff.godsEyeURL(context);
})();
