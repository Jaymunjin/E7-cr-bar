// ==== CALIBRATION (measure these once in an image editor) ====
// All Y values are in pixels in your screenshot resolution.

const CALIBRATION = {
  // Y position (in pixels) of 0% CR (top of usable bar)
  y0: 100,          // <-- replace with your measured value

  // Y position (in pixels) of 100% CR (where 100 actually is)
  y100: 600,        // <-- replace with your measured value

  // X position (in pixels) of the CR bar center line
  barX: 80,         // <-- replace with your measured value

  // Vertical scan half-width around barX (small, e.g. 3–5 px)
  barHalfWidth: 3
};

// Convert Y (pixel) to CR percentage
function yToCR(y) {
  const { y0, y100 } = CALIBRATION;
  const t = (y - y0) / (y100 - y0);
  const cr = t * 100;
  return Math.max(0, Math.min(100, cr));
}

// ==== Drag & drop handling ====

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
  dropzone.style.background = '';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => processImage(ev.target.result);
  reader.readAsDataURL(file);
});

// ==== Core processing ====

function processImage(dataUrl) {
  output.textContent = 'Processing...';

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const src = cv.imread(canvas);
    const crValues = detectCR(src);
    src.delete();

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

// Detect unit centers along the CR bar, return CR list top→bottom
function detectCR(src) {
  const { barX, barHalfWidth } = CALIBRATION;

  // Crop a narrow vertical strip around the bar
  const x = Math.max(0, barX - barHalfWidth);
  const w = Math.min(src.cols - x, barHalfWidth * 2 + 1);
  const y = 0;
  const h = src.rows;

  const roi = src.roi(new cv.Rect(x, y, w, h));

  // Convert to gray and blur a bit
  let gray = new cv.Mat();
  cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);

  // Edge detection
  let edges = new cv.Mat();
  cv.Canny(gray, edges, 50, 150);

  // Sum edges horizontally to get a 1D vertical profile
  let profile = new Array(h).fill(0);
  for (let yy = 0; yy < h; yy++) {
    let rowSum = 0;
    for (let xx = 0; xx < w; xx++) {
      rowSum += edges.ucharPtr(yy, xx)[0];
    }
    profile[yy] = rowSum;
  }

  gray.delete();
  edges.delete();
  roi.delete();

  // Find contiguous regions of strong edges (icon arcs)
  const threshold = Math.max(...profile) * 0.3; // heuristic
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
      if (end > start + 5) { // ignore tiny noise
        regions.push({ start, end });
      }
    }
  }
  if (inRegion) {
    const end = h - 1;
    if (end > start + 5) regions.push({ start, end });
  }

  // Each region corresponds to one circle crossing the bar
  // Center = midpoint of top and bottom arc
  const centersY = regions.map(r => (r.start + r.end) / 2);

  // Convert to CR and sort top→bottom (small Y to large Y)
  centersY.sort((a, b) => a - b);
  const crValues = centersY.map(yPix => yToCR(yPix));

  return crValues;
}
