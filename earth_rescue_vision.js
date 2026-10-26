/* One-image CLIP + YOLO review, separate from scripted mission actors. */
(() => {
  const canvas = $('visionPreview');
  const context = canvas.getContext('2d');
  let imageBlob = null;
  let lastResult = null;
  let stream = null;
  let busy = false;

  async function preview(blob) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    canvas.hidden = false;
    // Send exactly the pixels shown so EXIF rotation and boxes stay aligned.
    imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    lastResult = null;
    $('visionResults').replaceChildren();
    $('useVisionArea').disabled = true;
    $('analyseImage').disabled = false;
    $('visionStatus').textContent = 'Ready: analyse this image with both models.';
  }

  function showResult(result) {
    lastResult = result;
    const container = $('visionResults');
    container.replaceChildren();
    function line(text) {
      const element = document.createElement('p');
      element.textContent = text;
      container.append(element);
    }
    if (result.disaster) {
      line(`Disaster: ${result.disaster.category} · top score ${(result.disaster.confidence * 100).toFixed(1)}%`);
      for (const [name, score] of Object.entries(result.disaster.scores)) {
        line(`${name}: ${(score * 100).toFixed(1)}%`);
      }
    }
    if ('people_count' in result) line(`Possible people: ${result.people_count} · YOLO confidence threshold 35%`);
    const sx = canvas.width / result.width;
    const sy = canvas.height / result.height;
    context.strokeStyle = '#50ff9a';
    context.fillStyle = '#50ff9a';
    context.lineWidth = Math.max(2, canvas.width / 350);
    context.font = `${Math.max(14, canvas.width / 60)}px sans-serif`;
    for (const box of result.boxes) {
      const [x1, y1, x2, y2] = box.xyxy;
      context.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
      context.fillText(`person ${(box.confidence * 100).toFixed(0)}%`, x1 * sx, Math.max(16, y1 * sy - 4));
    }
    for (const [model, error] of Object.entries(result.errors)) line(`${model} unavailable: ${error}`);
    $('visionStatus').textContent = `AI review completed in ${result.elapsed_seconds}s · ${result.timestamp}. Scores are model estimates, not calibrated probabilities.`;
    $('useVisionArea').disabled = !result.disaster && !('people_count' in result);
  }

  $('visionFile').onchange = async event => {
    const file = event.target.files[0];
    if (!file || busy) return;
    try { await preview(file); }
    catch (error) { $('visionStatus').textContent = `Cannot open image: ${error.message}`; }
  };

  $('analyseImage').onclick = async () => {
    if (!imageBlob || busy) return;
    busy = true;
    $('analyseImage').disabled = true;
    $('visionFile').disabled = true;
    $('cameraCapture').disabled = true;
    $('useVisionArea').disabled = true;
    try {
      // Clear old annotations before repeating a review.
      const bitmap = await createImageBitmap(imageBlob);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      $('visionStatus').textContent = 'Starting both models. First use downloads pretrained weights; later reviews reuse them.';
      const response = await fetch('/api/vision', { method: 'POST', body: imageBlob });
      if (!response.ok) throw new Error(response.status === 409 ? 'Another review is running. Wait and retry.' : (await response.json()).error);
      while (true) {
        const poll = await fetch('/api/vision', { cache: 'no-store' });
        if (!poll.ok) throw new Error('Vision service unavailable. Restart the dashboard server.');
        const job = await poll.json();
        if (job.status === 'complete') { showResult(job.result); break; }
        $('visionStatus').textContent = job.message || 'Analysing…';
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      $('visionStatus').textContent = `Analysis failed: ${error.message}`;
    } finally {
      busy = false;
      $('analyseImage').disabled = !imageBlob;
      $('visionFile').disabled = false;
      $('cameraCapture').disabled = false;
    }
  };

  $('cameraCapture').onclick = async () => {
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        $('visionCamera').srcObject = stream;
        $('visionCamera').hidden = false;
        $('stopCamera').hidden = false;
        $('cameraCapture').textContent = 'Capture frame';
      } else {
        const video = $('visionCamera');
        if (!video.videoWidth) return;
        const snapshot = document.createElement('canvas');
        snapshot.width = video.videoWidth;
        snapshot.height = video.videoHeight;
        snapshot.getContext('2d').drawImage(video, 0, 0);
        await preview(await new Promise(resolve => snapshot.toBlob(resolve, 'image/jpeg')));
      }
    } catch (error) { $('visionStatus').textContent = `Camera unavailable: ${error.message}. You can upload a photo instead.`; }
  };
  function stopCamera() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    $('visionCamera').srcObject = null;
    $('visionCamera').hidden = true;
    $('stopCamera').hidden = true;
    $('cameraCapture').textContent = 'Camera';
  }
  $('stopCamera').onclick = stopCamera;
  window.addEventListener('pagehide', stopCamera);

  $('useVisionArea').onclick = () => {
    if (!lastResult) return;
    if (!selected || running || preparingMission) {
      $('visionStatus').textContent = 'Select a map area while the mission is stopped, then attach this review.';
      return;
    }
    const area = { ...selected };
    resetMission();
    setLocation(area.lat, area.lon, area.name, 'operator-placed image review', 'image has no verified geolocation');
    selected.demoScene = lastResult.disaster?.category.includes('flood') || false;
    logEvent('IMAGE_AI_REVIEW', JSON.stringify(lastResult));
    $('visionStatus').textContent = 'Review attached to the operator-selected area. Confirm the simulated candidate below, then load and launch.';
    $('candidate').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  $('restore3d').onclick = () => {
    if (mission) missionOverview();
    else runRescueDemo();
  };
})();
