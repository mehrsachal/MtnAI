/*
 * MtnAI ui — monoline SVG icons (24-unit grid, 1.6 stroke, current text colour).
 * <i data-icon="name"></i> placeholders are filled by UI.applyIcons().
 */
(function (UI) {
  'use strict';

  const P = {
    command: '<path d="M8 4a2 2 0 1 0 2 2v12a2 2 0 1 1-2-2h8a2 2 0 1 1-2 2V6a2 2 0 1 0 2-2Z"/>',
    download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5"/><path class="a" d="M5 19h14"/>',
    panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path class="a" d="M15 4.5v15"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8v.5"/><path class="a" d="M12 16.8v.2"/>',
    data: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path class="a" d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
    terrain: '<path d="M2.5 19.5 9 8l4 7 2.6-3.6 5.9 8.1Z"/><path class="a" d="m9 8 1.6 2.8M15.6 11.4l1.3 1.8"/>',
    mobility: '<path d="M4 18 9 6m6 12L20 6"/><path class="a" d="M11.2 18l.8-2.4m1-3 .8-2.4m1-3 .8-2.2" />',
    tactical: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v4m0 11v4M2.5 12h4m11 0h4"/><circle class="a" cx="12" cy="12" r="1.6"/>',
    route: '<circle cx="5.5" cy="18" r="2"/><circle cx="18.5" cy="6" r="2"/><path class="a" d="M7.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7.5"/>',
    tools: '<path d="m4 16.5 12.5-12.5 3.5 3.5L7.5 20Z"/><path class="a" d="m8 12.5 1.8 1.8M10.5 10l1.2 1.2M13 7.5l1.8 1.8"/>',
    layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5Z"/><path class="a" d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.2 12 20.7l8.5-4.5"/>',
    open: '<path d="M3.5 7.5V18a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1V9.5a1 1 0 0 0-1-1h-8l-2-2.5h-5a1 1 0 0 0-1 1Z"/><path class="a" d="M12 16v-5m-2.2 2.2L12 11l2.2 2.2"/>',
    crop: '<path d="M7 3v14h14M3 7h14v14"/><path class="a" d="M10 10h4v4h-4Z"/>',
    peak: '<path d="M3 19 12 5l9 14Z"/><path class="a" d="M12 5v-1.5"/>',
    nogo: '<rect x="4" y="4" width="16" height="16" rx="1"/><path class="a" d="m4 9 5-5m-5 11L15 4m-11 16L20 4M9 20l11-11m-5 11 5-5"/>',
    track: '<path d="M5 20c2-5 12-5 14-16"/><path class="a" d="M6.5 16.5 8 18m3-4.5 1.3 1.5m2.5-5 1.5 1.2m.8-5.2 1.8.8"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle class="a" cx="12" cy="12" r="3"/>',
    axis: '<path d="M4 18c3-1 5-4 7-7s4-5 8-6"/><path class="a" d="m15 4.5 4 .5-.8 3.8"/>',
    post: '<rect x="4" y="8" width="16" height="11" rx="0.5"/><path d="m4 8 16 11M4 19 20 8"/><path class="a" d="M8 5h.01M12 5h.01M16 5h.01" stroke-width="2.6"/>',
    mine: '<circle cx="12" cy="13" r="5"/><path class="a" d="m6 6 3 3m9-3-3 3"/>',
    fly: '<path d="M3 13.5 21 6l-6.5 14-3-6.5Z"/><path class="a" d="m11.5 13.5 3-3"/>',
    los: '<circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path class="a" d="m6.8 15.8 10.4-7.6" stroke-dasharray="2 2"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect class="a" x="9" y="9" width="6" height="6" rx="0.5"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle class="a" cx="12" cy="12" r="2.5"/>',
    log: '<path d="M5 6h3M5 12h3M5 18h3"/><path class="a" d="M11 6h8M11 12h8M11 18h5"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="1"/><path class="a" d="M5 15V5a1 1 0 0 1 1-1h9"/>',
    save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    plus: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M8 11h6M11 8v6"/>',
    minus: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M8 11h6"/>',
    ruler: '<path d="m3.5 15.5 12-12 5 5-12 12Z"/><path d="m7 12 1.6 1.6M9.5 9.5l2.4 2.4M12 7l1.6 1.6"/>',
    doc: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 15h6M9 18h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.5"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6"/><path class="a" d="m15 15 5 5"/>',
    ok: '<path class="a" d="m5 12.5 4.5 4.5L19 7.5"/>',
    err: '<path d="m6 6 12 12M18 6 6 18"/>',
  };

  UI.icon = (name, size = 18) =>
    `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

  UI.applyIcons = (root = document) => {
    root.querySelectorAll('i[data-icon]').forEach((el) => {
      if (el.dataset.done) return;
      el.innerHTML = UI.icon(el.dataset.icon, +el.dataset.size || 16);
      el.dataset.done = '1';
    });
  };
})(globalThis.MTN_UI = globalThis.MTN_UI || {});
