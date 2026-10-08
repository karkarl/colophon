export function renderInsertPalette() {
  return `<details id="insert-palette" class="insert-palette">
    <summary>Insert layer</summary>
    <p>Click to add to the selection, or drag onto the canvas.</p>
    <div id="insert-items" class="insert-items"></div>
  </details>`;
}
export function renderWorkspaceControls({ zoom = true } = {}) {
  return `<div class="inspect-view-controls">
    ${zoom ? `<label>Zoom <select id="inspect-zoom" aria-label="Canvas zoom">
      <option value="0.5">50%</option><option value="0.75">75%</option>
      <option value="1" selected>100%</option><option value="1.5">150%</option><option value="2">200%</option>
    </select></label>` : ""}
    <button type="button" id="select-parent-btn" class="btn" disabled>Parent</button>
  </div>`;
}
export function renderWorkspaceOverlays() {
  return `<div id="inspect-overlays" hidden>
    <div id="inspect-hover-box" class="inspect-bounds hover-bounds" hidden></div>
    <div id="inspect-selection-box" class="inspect-bounds" hidden>
      <span id="inspect-measurement" class="inspect-measurement"></span>
      <button type="button" class="resize-handle" data-resize="e" aria-label="Resize width" title="Drag to resize width; use Width in Properties for keyboard editing"></button>
      <button type="button" class="resize-handle" data-resize="s" aria-label="Resize height" title="Drag to resize height; use Height in Properties for keyboard editing"></button>
      <button type="button" class="resize-handle" data-resize="se" aria-label="Resize width and height" title="Drag to resize; Shift preserves aspect ratio"></button>
    </div>
    <div id="inspect-drop-box" class="inspect-bounds drop-bounds" hidden><span id="inspect-drop-label" class="inspect-measurement"></span></div>
  </div>
  <div id="inspect-announcement" class="inspect-sr-only" role="status" aria-live="polite"></div>`;
}
