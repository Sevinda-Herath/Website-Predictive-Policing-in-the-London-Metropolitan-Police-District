const menu = document.querySelector('[data-mobile-menu]');
const openButton = document.querySelector('[data-menu-open]');
const closeButton = document.querySelector('[data-menu-close]');
const menuLinks = document.querySelectorAll('[data-menu-link]');
const mapModal = document.querySelector('[data-map-modal]');
const mapModalOpenButton = document.querySelector('[data-map-modal-open]');
const mapModalCloseButton = document.querySelector('[data-map-modal-close]');
const embeddedMapFrame = document.querySelector('.map-embed-frame');
const expandedMapFrame = document.querySelector('.map-modal-frame');
const mapNewTabLink = document.querySelector('.map-actions a[href$="crime_map.html"]');
const predictionsPage = document.querySelector('[data-predictions-page]');

const DEFAULT_API_BASE_URL = 'http://4.154.77.182:8000';
const API_STORAGE_KEY = 'crimePredictionApiBaseUrl';

function getMapUrl() {
  return new URL('crime_map.html', window.location.href).toString();
}

function getExpandedMapUrl() {
  const configuredSrc = expandedMapFrame?.getAttribute('data-map-src');
  if (configuredSrc) {
    return new URL(configuredSrc, window.location.href).toString();
  }

  return getMapUrl();
}

function syncMapUrlsToCurrentOrigin() {
  const mapUrl = getMapUrl();
  const mapPath = 'crime_map.html';

  if (embeddedMapFrame) {
    embeddedMapFrame.src = mapUrl;
  }

  // Keep modal iframe unloaded until user opens it.
  if (expandedMapFrame && !expandedMapFrame.getAttribute('data-map-src')) {
    expandedMapFrame.setAttribute('data-map-src', mapPath);
  }

  if (mapNewTabLink) {
    mapNewTabLink.href = mapUrl;
  }
}

function normalizeApiBaseUrl(url) {
  return url.trim().replace(/\/+$/, '');
}

function getSavedApiBaseUrl() {
  const saved = window.localStorage.getItem(API_STORAGE_KEY);

  if (!saved) {
    return DEFAULT_API_BASE_URL;
  }

  return normalizeApiBaseUrl(saved);
}

function setStatusState(element, text, stateClass) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.classList.remove('is-ok', 'is-error', 'is-loading');

  if (stateClass) {
    element.classList.add(stateClass);
  }
}

function isValidRows(rows) {
  return Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object';
}

function toCsv(rows) {
  if (!isValidRows(rows)) {
    return '';
  }

  const columns = Object.keys(rows[0]);
  const escapeValue = (value) => {
    const text = value === null || value === undefined ? '' : String(value);

    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  };

  const lines = [columns.join(',')];

  rows.forEach((row) => {
    const values = columns.map((column) => escapeValue(row[column]));
    lines.push(values.join(','));
  });

  return lines.join('\n');
}

function triggerCsvDownload(fileName, rows) {
  const csv = toCsv(rows);

  if (!csv) {
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function fetchJson(apiBaseUrl, path, options = {}) {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined && options.body !== null;

  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const detail = payload?.detail;
    const errorMessage = typeof detail === 'string' ? detail : `${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }

  return payload;
}

function getNetworkFailureHint(apiBaseUrl, error) {
  if (!(error instanceof TypeError)) {
    return '';
  }

  if (window.location.protocol === 'https:' && apiBaseUrl.startsWith('http://')) {
    return ' Likely cause: mixed content (HTTPS page calling HTTP API).';
  }

  return ' Likely cause: CORS is not enabled on the API.';
}

function renderSimpleMessage(container, message, className) {
  if (!container) {
    return;
  }

  container.classList.remove('is-ok', 'is-error');
  if (className) {
    container.classList.add(className);
  }
  container.textContent = message;
}

function renderPredictionResult(container, result) {
  if (!container) {
    return;
  }

  container.classList.remove('is-error');
  container.classList.add('is-ok');
  container.textContent = '';

  const title = document.createElement('h3');
  title.className = 'result-title';
  title.textContent = 'Prediction result';

  const list = document.createElement('ul');
  list.className = 'result-list';

  const items = [
    ['LSOA code', result.lsoa_code],
    ['LSOA name', result.lsoa_name],
    ['Year', result.year],
    ['Month', result.month],
    ['Predicted crime count', result.predicted_crime_count],
    ['Target', result.target],
  ];

  items.forEach(([label, value]) => {
    const li = document.createElement('li');
    const strong = document.createElement('strong');

    strong.textContent = `${label}: `;
    li.append(strong, document.createTextNode(String(value)));
    list.append(li);
  });

  container.append(title, list);
}

function setMetric(selector, value) {
  const metric = document.querySelector(selector);

  if (metric) {
    metric.textContent = String(value);
  }
}

function renderHotspotsTable(table, rows) {
  if (!table) {
    return;
  }

  const tbody = table.querySelector('tbody');
  if (!tbody) {
    return;
  }

  tbody.textContent = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No hotspot rows returned for this selection.';
    tr.append(td);
    tbody.append(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = [
      row.rank,
      row.lsoa_code,
      row.lsoa_name,
      row.predicted_crime_count,
    ];

    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    });

    tbody.append(tr);
  });
}

function renderDynamicTable(table, rows, emptyMessage) {
  if (!table) {
    return;
  }

  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  if (!thead || !tbody) {
    return;
  }

  thead.textContent = '';
  tbody.textContent = '';

  if (!isValidRows(rows)) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = emptyMessage;
    tr.append(td);
    tbody.append(tr);
    return;
  }

  const columns = Object.keys(rows[0]);
  const headerRow = document.createElement('tr');

  columns.forEach((column) => {
    const th = document.createElement('th');
    th.textContent = column;
    headerRow.append(th);
  });

  thead.append(headerRow);

  rows.forEach((row) => {
    const tr = document.createElement('tr');

    columns.forEach((column) => {
      const td = document.createElement('td');
      td.textContent = String(row[column]);
      tr.append(td);
    });

    tbody.append(tr);
  });
}

function configureEvaluationImages(apiBaseUrl) {
  const hdaImage = document.querySelector('[data-hda-image]');
  const mpcImage = document.querySelector('[data-mpc-image]');
  const hdaLink = document.querySelector('[data-download-hda]');
  const mpcLink = document.querySelector('[data-download-mpc]');
  const hdaUrl = `${apiBaseUrl}/images/hda`;
  const mpcUrl = `${apiBaseUrl}/images/mpc`;

  if (hdaImage) {
    hdaImage.src = hdaUrl;
  }

  if (mpcImage) {
    mpcImage.src = mpcUrl;
  }

  if (hdaLink) {
    hdaLink.href = hdaUrl;
  }

  if (mpcLink) {
    mpcLink.href = mpcUrl;
  }
}

function initializePredictionsPage() {
  if (!predictionsPage) {
    return;
  }

  const apiForm = document.querySelector('[data-api-form]');
  const apiInput = apiForm?.elements?.api_base_url;
  const apiStatus = document.querySelector('[data-api-status]');
  const apiCheckButton = document.querySelector('[data-api-check]');
  const predictForm = document.querySelector('[data-predict-form]');
  const predictResult = document.querySelector('[data-predict-result]');
  const hotspotsForm = document.querySelector('[data-hotspots-form]');
  const hotspotsTable = document.querySelector('[data-hotspots-table]');
  const hotspotsDownloadButton = document.querySelector('[data-hotspots-download]');
  const genericTable = document.querySelector('[data-generic-table]');
  const specificTable = document.querySelector('[data-specific-table]');
  const loadGenericButton = document.querySelector('[data-load-generic]');
  const loadSpecificButton = document.querySelector('[data-load-specific]');
  const genericDownloadButton = document.querySelector('[data-download-generic]');
  const specificDownloadButton = document.querySelector('[data-download-specific]');

  const state = {
    apiBaseUrl: getSavedApiBaseUrl(),
    hotspotRows: [],
    genericRows: [],
    specificRows: [],
  };

  const updateRowsMetric = () => {
    const totalRows = state.genericRows.length + state.specificRows.length;
    setMetric('[data-metric="rows"]', totalRows);
  };

  const runApiHealthCheck = async () => {
    setStatusState(apiStatus, 'Checking API connection...', 'is-loading');

    try {
      const payload = await fetchJson(state.apiBaseUrl, '/');
      const message = payload?.message || 'API is reachable.';
      setStatusState(apiStatus, `API status: ${message}`, 'is-ok');
    } catch (error) {
      const hint = getNetworkFailureHint(state.apiBaseUrl, error);
      setStatusState(apiStatus, `API status: ${error.message}.${hint}`.replace('..', '.'), 'is-error');
    }
  };

  const loadComparison = async (type) => {
    const isGeneric = type === 'generic';
    const path = isGeneric ? '/model-comparison/generic' : '/model-comparison/specific';
    const table = isGeneric ? genericTable : specificTable;
    const loadButton = isGeneric ? loadGenericButton : loadSpecificButton;
    const downloadButton = isGeneric ? genericDownloadButton : specificDownloadButton;
    const emptyMessage = isGeneric
      ? 'No rows found for generic comparison.'
      : 'No rows found for specific comparison.';

    loadButton?.setAttribute('disabled', 'true');

    try {
      const payload = await fetchJson(state.apiBaseUrl, path);
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];

      if (isGeneric) {
        state.genericRows = rows;
      } else {
        state.specificRows = rows;
      }

      renderDynamicTable(table, rows, emptyMessage);
      downloadButton?.toggleAttribute('disabled', rows.length === 0);
      updateRowsMetric();
    } catch (error) {
      renderDynamicTable(table, [], error.message);
      downloadButton?.setAttribute('disabled', 'true');
    } finally {
      loadButton?.removeAttribute('disabled');
    }
  };

  if (apiInput) {
    apiInput.value = state.apiBaseUrl;
  }

  configureEvaluationImages(state.apiBaseUrl);

  apiForm?.addEventListener('submit', (event) => {
    event.preventDefault();

    const nextValue = normalizeApiBaseUrl(String(apiInput?.value || ''));
    if (!nextValue) {
      setStatusState(apiStatus, 'API status: Please enter a valid API URL.', 'is-error');
      return;
    }

    state.apiBaseUrl = nextValue;
    window.localStorage.setItem(API_STORAGE_KEY, nextValue);
    configureEvaluationImages(state.apiBaseUrl);
    setStatusState(apiStatus, `API status: Saved ${state.apiBaseUrl}`, 'is-ok');
  });

  apiCheckButton?.addEventListener('click', runApiHealthCheck);

  predictForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(predictForm);
    const lsoaCode = String(formData.get('lsoa_code') || '').trim();
    const lsoaName = String(formData.get('lsoa_name') || '').trim();
    const year = Number(formData.get('year'));
    const month = Number(formData.get('month'));

    if (!lsoaCode && !lsoaName) {
      renderSimpleMessage(predictResult, 'Please provide either LSOA code or LSOA name.', 'is-error');
      return;
    }

    const payload = { year, month };
    if (lsoaCode) {
      payload.lsoa_code = lsoaCode;
    }
    if (lsoaName) {
      payload.lsoa_name = lsoaName;
    }

    renderSimpleMessage(predictResult, 'Running prediction...', '');

    try {
      const result = await fetchJson(state.apiBaseUrl, '/predict', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      renderPredictionResult(predictResult, result);
      setMetric('[data-metric="prediction"]', Number(result.predicted_crime_count).toFixed(2));
    } catch (error) {
      const hint = getNetworkFailureHint(state.apiBaseUrl, error);
      renderSimpleMessage(predictResult, `Prediction failed: ${error.message}.${hint}`.replace('..', '.'), 'is-error');
    }
  });

  hotspotsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(hotspotsForm);
    const payload = {
      year: Number(formData.get('year')),
      month: Number(formData.get('month')),
      top_x: Number(formData.get('top_x')),
    };

    renderHotspotsTable(hotspotsTable, []);

    try {
      const result = await fetchJson(state.apiBaseUrl, '/hotspots/top', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      state.hotspotRows = Array.isArray(result.hotspots) ? result.hotspots : [];
      renderHotspotsTable(hotspotsTable, state.hotspotRows);
      hotspotsDownloadButton?.toggleAttribute('disabled', state.hotspotRows.length === 0);

      const topValue = state.hotspotRows.length
        ? Number(state.hotspotRows[0].predicted_crime_count).toFixed(2)
        : '-';
      setMetric('[data-metric="hotspot"]', topValue);
    } catch (error) {
      renderHotspotsTable(hotspotsTable, []);
      const tbody = hotspotsTable?.querySelector('tbody');
      if (tbody) {
        tbody.textContent = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        const hint = getNetworkFailureHint(state.apiBaseUrl, error);
        td.textContent = `Hotspot request failed: ${error.message}.${hint}`.replace('..', '.');
        tr.append(td);
        tbody.append(tr);
      }
      hotspotsDownloadButton?.setAttribute('disabled', 'true');
    }
  });

  loadGenericButton?.addEventListener('click', () => {
    loadComparison('generic');
  });

  loadSpecificButton?.addEventListener('click', () => {
    loadComparison('specific');
  });

  hotspotsDownloadButton?.addEventListener('click', () => {
    triggerCsvDownload('hotspots_top.csv', state.hotspotRows);
  });

  genericDownloadButton?.addEventListener('click', () => {
    triggerCsvDownload('model_comparison_generic.csv', state.genericRows);
  });

  specificDownloadButton?.addEventListener('click', () => {
    triggerCsvDownload('model_comparison_specific.csv', state.specificRows);
  });

  runApiHealthCheck();
  loadComparison('generic');
  loadComparison('specific');
}

function openMenu() {
  if (!menu) {
    return;
  }

  menu.classList.add('is-open');
  document.body.classList.add('menu-open');
  openButton?.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
  if (!menu) {
    return;
  }

  menu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  openButton?.setAttribute('aria-expanded', 'false');
}

function openMapModal() {
  if (!mapModal) {
    return;
  }

  const mapUrl = getExpandedMapUrl();

  if (expandedMapFrame && expandedMapFrame.src !== mapUrl) {
    expandedMapFrame.src = mapUrl;
  }

  mapModal.classList.add('is-open');
  mapModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');
}

function closeMapModal() {
  if (!mapModal) {
    return;
  }

  mapModal.classList.remove('is-open');
  mapModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('menu-open');
}

openButton?.addEventListener('click', openMenu);
closeButton?.addEventListener('click', closeMenu);
mapModalOpenButton?.addEventListener('click', openMapModal);
mapModalCloseButton?.addEventListener('click', closeMapModal);

menuLinks.forEach((link) => {
  link.addEventListener('click', closeMenu);
});

menu?.addEventListener('click', (event) => {
  if (event.target === menu) {
    closeMenu();
  }
});

mapModal?.addEventListener('click', (event) => {
  if (event.target === mapModal) {
    closeMapModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeMenu();
    closeMapModal();
  }
});

if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}

syncMapUrlsToCurrentOrigin();
initializePredictionsPage();
