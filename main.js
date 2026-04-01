const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const btnFiles = document.getElementById('btnFiles');
const btnFolder = document.getElementById('btnFolder');
const dropZone = document.getElementById('dropZone');
const minLengthInput = document.getElementById('minLength');
const encodingSelect = document.getElementById('encoding');
const resultsSection = document.getElementById('results');
const outputDiv = document.getElementById('output');
const statsSpan = document.getElementById('stats');
const btnCopy = document.getElementById('btnCopy');
const btnDownload = document.getElementById('btnDownload');
const btnClear = document.getElementById('btnClear');

let lastResultText = '';

// ── Event wiring ──

btnFiles.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
btnFolder.addEventListener('click', (e) => { e.stopPropagation(); folderInput.click(); });
dropZone.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  fileInput.click();
});

fileInput.addEventListener('change', () => processFiles(Array.from(fileInput.files)));
folderInput.addEventListener('change', () => processFiles(Array.from(folderInput.files)));

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');

  // Use webkitGetAsEntry/getAsEntry to properly handle dropped folders
  const items = e.dataTransfer.items;
  if (items && items.length > 0 && (items[0].webkitGetAsEntry || items[0].getAsEntry)) {
    const files = await getAllFilesFromDataTransfer(items);
    processFiles(files);
  } else {
    processFiles(Array.from(e.dataTransfer.files));
  }
});

btnCopy.addEventListener('click', () => {
  copyToClipboard(lastResultText).then(() => {
    btnCopy.textContent = 'Copied!';
    setTimeout(() => btnCopy.textContent = 'Copy All', 1500);
  });
});

btnDownload.addEventListener('click', () => {
  const blob = new Blob([lastResultText], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'strings_output.txt';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Delay cleanup so Safari can start the download
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 100);
});

btnClear.addEventListener('click', () => {
  resultsSection.classList.add('hidden');
  outputDiv.innerHTML = '';
  lastResultText = '';
});

// ── Clipboard with fallback ──

async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) {
      // Fall through to fallback
    }
  }
  // Fallback: hidden textarea + execCommand (works in all Safari versions)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ── Drag-and-drop folder traversal ──

async function getAllFilesFromDataTransfer(dataTransferItems) {
  const files = [];
  const entries = [];

  for (let i = 0; i < dataTransferItems.length; i++) {
    const entry = dataTransferItems[i].webkitGetAsEntry
      ? dataTransferItems[i].webkitGetAsEntry()
      : dataTransferItems[i].getAsEntry
        ? dataTransferItems[i].getAsEntry()
        : null;
    if (entry) {
      entries.push(entry);
    }
  }

  async function traverse(entry, path) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      // Attach a path so we can display it grouped by folder
      Object.defineProperty(file, '_path', { value: path + file.name });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries may not return all entries at once — must call repeatedly
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) {
          await traverse(child, path + entry.name + '/');
        }
      } while (batch.length > 0);
    }
  }

  for (const entry of entries) {
    await traverse(entry, '');
  }

  return files;
}

// ── Core logic ──

async function processFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  const minLen = Math.max(1, parseInt(minLengthInput.value, 10) || 4);
  const encoding = encodingSelect.value;

  outputDiv.innerHTML = '';
  lastResultText = '';
  resultsSection.classList.remove('hidden');

  let totalStrings = 0;
  let totalFiles = 0;
  const textParts = [];
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const strings = extractStrings(bytes, minLen, encoding);
    if (strings.length === 0) continue;

    totalFiles++;
    totalStrings += strings.length;

    const group = document.createElement('div');
    group.className = 'file-group';

    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    const filePath = file._path || file.webkitRelativePath || file.name;
    nameEl.textContent = filePath;
    group.appendChild(nameEl);

    textParts.push(`── ${filePath} ──`);

    for (let j = 0; j < strings.length; j++) {
      const line = document.createElement('div');
      line.className = 'string-line';
      line.textContent = strings[j];
      group.appendChild(line);
      textParts.push(strings[j]);
    }

    textParts.push('');
    fragment.appendChild(group);
  }

  outputDiv.appendChild(fragment);
  lastResultText = textParts.join('\n');
  statsSpan.textContent = `${totalStrings} strings from ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;

  if (totalFiles === 0) {
    outputDiv.innerHTML = '<p style="color:var(--text-muted)">No readable strings found.</p>';
    statsSpan.textContent = '';
  }
}

/**
 * Extract readable strings from a byte array.
 * Supports ASCII (printable bytes 0x20-0x7E + tab/newline) and
 * UTF-16 LE/BE (printable chars with 0x00 high byte).
 */
function extractStrings(bytes, minLen, encoding) {
  const results = [];

  if (encoding === 'ascii' || encoding === 'both') {
    extractAscii(bytes, minLen, results);
  }

  if (encoding === 'utf16' || encoding === 'both') {
    extractUtf16(bytes, minLen, results);
  }

  // Deduplicate: UTF-16 extraction may find strings also found by ASCII pass
  if (encoding === 'both') {
    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < results.length; i++) {
      if (!seen.has(results[i])) {
        seen.add(results[i]);
        deduped.push(results[i]);
      }
    }
    return deduped;
  }

  return results;
}

function isReadable(b) {
  return (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
}

function extractAscii(bytes, minLen, out) {
  let current = '';
  for (let i = 0; i < bytes.length; i++) {
    if (isReadable(bytes[i])) {
      current += String.fromCharCode(bytes[i]);
    } else {
      if (current.length >= minLen) {
        out.push(current);
      }
      current = '';
    }
  }
  if (current.length >= minLen) {
    out.push(current);
  }
}

function extractUtf16(bytes, minLen, out) {
  // Try both little-endian and big-endian
  extractUtf16WithEndian(bytes, minLen, out, true);
  extractUtf16WithEndian(bytes, minLen, out, false);
}

function extractUtf16WithEndian(bytes, minLen, out, littleEndian) {
  let current = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = littleEndian ? bytes[i] : bytes[i + 1];
    const hi = littleEndian ? bytes[i + 1] : bytes[i];

    // Basic printable: hi byte is 0, lo byte is printable ASCII
    if (hi === 0 && isReadable(lo)) {
      current += String.fromCharCode(lo);
    } else {
      if (current.length >= minLen) {
        out.push(current);
      }
      current = '';
    }
  }
  if (current.length >= minLen) {
    out.push(current);
  }
}
