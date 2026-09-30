const paths = {
  rift: '<path d="m13 2-4 8 5 3-3 9 9-12-6-2 2-6M3 7l3 2M18 17l3 2"/>',
  fullscreen: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  sound:
    '<path d="m11 4-5 4H2v8h4l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  arrow: '<path d="M5 19 19 5M6 5h13v13"/>',
  palm: '<path d="M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-2 7-6 7H11c-2 0-3-1-4-3l-4-6c-1-2 1-3 2-2l2 2Z"/>',
  sign: '<path d="m9 13-3-9c-.5-2 2-3 3-1l3 8 2-8c.5-2 3-1.5 3 .5l-1 10c3-2 5 0 4 3l-2 4c-1 2-3 3-6 2l-4-2-4-5c-2-3 0-4 2-2l3 3"/>',
  seal: '<circle cx="12" cy="12" r="9"/><path d="m12 3 8 14H4L12 3Zm0 5v9M7 12h10"/>',
  shield:
    '<path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
  slash: '<path d="M19 2 4 18l8-3-2 7L22 8l-8 3 5-9Z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  camera:
    '<rect x="2" y="6" width="15" height="13" rx="3"/><path d="m17 10 5-3v12l-5-3M7 6V3h5"/><circle cx="9" cy="12" r="3"/>',
  move: '<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4"/>',
};
export type Icon = keyof typeof paths;
export function icon(name: Icon, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
