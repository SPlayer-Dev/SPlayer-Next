export { createWindow } from "./create";
export { createMainWindow, getMainWindow, focusMainWindow, setTaskbarProgress } from "./main";
export {
  createDesktopLyricWindow,
  closeDesktopLyricWindow,
  toggleDesktopLyricWindow,
  getDesktopLyricWindow,
  applyDesktopLyricLock,
  applyDesktopLyricAlwaysOnTop,
  applyDesktopLyricMouseIgnore,
  applyDesktopLyricHeight,
  moveDesktopLyricWindow,
  freezeDesktopLyricSize,
  getDesktopLyricBounds,
} from "./desktopLyric";
