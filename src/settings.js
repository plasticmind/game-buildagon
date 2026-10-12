// Player settings, persisted to localStorage. The UI edits this object in place
// and emits 'settings'; main.js applies the changes to each system.

const KEY = 'buildagon.settings.v1';

export const DEFAULT_SETTINGS = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambienceVolume: 0.6,
  musicVolume: 0.35,
  musicStyle: 'piano', // 'piano' (soundtrack), 'chimes' (generative), or 'off'
  mouseSensitivity: 1,
  invertY: false,
  cameraSpeed: 1,
  dayLengthMinutes: 14, // Real minutes per in-game day.
  timePaused: false,
  windStrength: 1, // 0..2
  quality: 'high', // 'low' | 'medium' | 'high'
  grassDensity: 1, // 0..1
  showHints: true,
};

export const settings = { ...DEFAULT_SETTINGS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch {
    // Storage can be unavailable (private mode); defaults are fine.
  }
  return settings;
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}
