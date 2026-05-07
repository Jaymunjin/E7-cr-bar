// =========================
// CONFIGURATION
// =========================

// OpenCV readiness flag
let cvReady = false;
cv['onRuntimeInitialized'] = () => {
  cvReady = true;
};

// Relative offsets from hourglass bottom (measured from your screenshots)
const CALIBRATION = {
  relY0: 12,      // 0% CR is 12px below hourglass bottom
  relY100: 435,   // 100% CR is 435px below hourglass bottom

  barOffsetX: 0,  // CR bar is horizontally aligned with hourglass center
  barHalfWidth: 3 // scan ±3px around bar center
};

// =========================
// DRAG & DROP HANDLING
// =========================

const dropzone = document.getElementById('dropzone');
const output = document.getElementById('output');

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.style.background = '#f0f0f0';
});

dropzone.addEventListener('dragleave', e => {
  e.preventDefault();
  dropzone.style.background = '';
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();

  if (!cvReady) {
    output.textContent = "OpenCV not ready yet";
    return;
  }

  dropzone.style.background = '';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => processImage(ev.target.result);
  reader.readAsDataURL(file);
});

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.style.background = '#f0f0f0';
});

dropzone.addEventListener('dragleave', e => {
  e.preventDefault();
  dropzone.style.background = '';
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  if (!cvReady) {
    output.textContent = "OpenCV not ready yet";
    return;
  }
  dropzone.style.background = '';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => processImage(ev.target.result);
  reader.readAsDataURL(file);
});

// =========================
// MAIN PROCESSING PIPELINE
// =========================

async function processImage(dataUrl) {
  output.textContent = 'Processing...';

  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const src = cv.imread(canvas);

    // Load hourglass template
    const template = await loadHourglassTemplate();

    // Find hourglass location
    const hourglass = findHourglass(src, template);
    if (!hourglass) {
      output.textContent = 'Hourglass not found.';
      src.delete();
      template.delete();
      return;
    }

    const hourglassBottomY = hourglass.y + hourglass.h;

    // Compute absolute CR positions
    const y0 = hourglassBottomY + CALIBRATION.relY0;
    const y100 = hourglassBottomY + CALIBRATION.relY100;

    // Detect CR bar X position
    const barX = hourglass.x + hourglass.w / 2 + CALIBRATION.barOffsetX;

    // Detect unit CR values
    const crValues = detectCR(src, barX, y0, y100);

    src.delete();
    template.delete();

    if (!crValues.length) {
      output.textContent = 'No units detected on CR bar.';
      return;
    }

    let text = '';
    crValues.forEach((cr, i) => {
      text += `Unit ${i + 1}: ${cr.toFixed(2)}%\n`;
    });
    output.textContent = text;
  };
  img.src = dataUrl;
}

// =========================
// LOAD HOURGLASS TEMPLATE
// =========================

function loadHourglassTemplate() {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const mat = cv.imread(c);
      resolve(mat);
    };
    img.src = 'hourglass.png';
  });
}

// =========================
// TEMPLATE MATCHING
// =========================

function findHourglass(src, template) {
  const result = new cv.Mat();
  const mask = new cv.Mat();
  cv.matchTemplate(src, template, result, cv.TM_CCOEFF_NORMED, mask);

  let min = {value: 0};
  let max = {value: 0};
  let minLoc = {x: 0, y: 0};
  let maxLoc = {x: 0, y: 0};
  cv.minMaxLoc(result, min, max, minLoc, maxLoc);

  result.delete();
  mask.delete();

  if (max.value < 0.5) return null; // threshold

  return {
    x: maxLoc.x,
    y: maxLoc.y,
    w: template.cols,
    h: template.rows
  };
}

// =========================
// CR BAR SCANNING
// =========================

function detectCR(src, barX, y0, y100) {
  const x = Math.max(0, Math.round(barX - CALIBRATION.barHalfWidth));
  const w = Math.min(src.cols - x, CALIBRATION.barHalfWidth * 2 + 1);
  const y = 0;
  const h = src.rows;

  const roi = src.roi(new cv.Rect(x, y, w, h));

  let gray = new cv.Mat();
  cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);

  let edges = new cv.Mat();
  cv.Canny(gray, edges, 50, 150);

  let profile = new Array(h).fill(0);
  for (let yy = 0; yy < h; yy++) {
    let sum = 0;
    for (let xx = 0; xx < w; xx++) {
      sum += edges.ucharPtr(yy, xx)[0];
    }
    profile[yy] = sum;
  }

  gray.delete();
  edges.delete();
  roi.delete();

  const threshold = Math.max(...profile) * 0.3;
  let regions = [];
  let inRegion = false;
  let start = 0;

  for (let yy = 0; yy < h; yy++) {
    if (!inRegion && profile[yy] > threshold) {
      inRegion = true;
      start = yy;
    } else if (inRegion && profile[yy] <= threshold) {
      inRegion = false;
      const end = yy - 1;
      if (end > start + 5) regions.push({start, end});
    }
  }
  if (inRegion) {
    const end = h - 1;
    if (end > start + 5) regions.push({start, end});
  }

  const centersY = regions.map(r => (r.start + r.end) / 2);
  centersY.sort((a, b) => a - b);

  return centersY.map(yPix => {
    const t = (yPix - y0) / (y100 - y0);
    return Math.max(0, Math.min(100, t * 100));
  });
}
