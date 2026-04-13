/** 主窗口几何 */
export interface MainWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

/** 桌面歌词窗口几何 */
export interface DesktopLyricWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
}

/** 所有窗口状态 */
export interface WindowStates {
  main: MainWindowState;
  desktopLyric: DesktopLyricWindowState;
}
