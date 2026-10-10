/* Installed-font discovery for the Appearance settings.
 * Chromium exposes every installed family through the Local Font Access API after
 * the user allows it. Firefox has no listing API, so Specter checks common families
 * from Windows, macOS, and Linux by measuring rendered text against generic fallbacks.
 */
(function (root) {
  const COMMON_FAMILIES = [
    // Windows
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Cascadia Mono',
    'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Ebrima', 'Franklin Gothic Medium',
    'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Ink Free', 'Leelawadee UI', 'Lucida Console',
    'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft YaHei', 'MS Gothic', 'Palatino Linotype', 'Segoe Print',
    'Segoe Script', 'Segoe UI', 'Segoe UI Variable', 'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman',
    'Trebuchet MS', 'Verdana', 'Yu Gothic',
    // macOS
    'American Typewriter', 'Andale Mono', 'Avenir', 'Avenir Next', 'Baskerville', 'Big Caslon', 'Charter',
    'Chalkboard SE', 'Cochin', 'Copperplate', 'Didot', 'Futura', 'Geneva', 'Gill Sans', 'Helvetica',
    'Helvetica Neue', 'Hiragino Sans', 'Hoefler Text', 'Iowan Old Style', 'Lucida Grande', 'Marker Felt',
    'Menlo', 'Monaco', 'New York', 'Optima', 'Palatino', 'PingFang SC', 'Rockwell', 'SF Mono', 'SF Pro',
    'SF Pro Display', 'SF Pro Text', 'Skia', 'Superclarendon',
    // Linux and widely installed open fonts
    'Adwaita Sans', 'Adwaita Mono', 'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif',
    'Droid Sans', 'Droid Sans Mono', 'Fira Code', 'Fira Mono', 'Fira Sans', 'FreeMono', 'FreeSans', 'FreeSerif',
    'Hack', 'IBM Plex Mono', 'IBM Plex Sans', 'IBM Plex Serif', 'Inconsolata', 'Inter', 'Iosevka',
    'JetBrains Mono', 'Lato', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Merriweather',
    'Montserrat', 'Noto Color Emoji', 'Noto Mono', 'Noto Sans', 'Noto Sans CJK SC', 'Noto Sans Mono',
    'Noto Serif', 'Nunito', 'Open Sans', 'Oxygen', 'Poppins', 'PT Sans', 'PT Serif', 'Raleway', 'Roboto',
    'Roboto Mono', 'Roboto Slab', 'Source Code Pro', 'Source Sans 3', 'Source Sans Pro', 'Source Serif 4',
    'Ubuntu', 'Ubuntu Mono', 'Ubuntu Sans', 'Victor Mono', 'Work Sans'
  ];
  const GENERIC = ['monospace', 'serif', 'sans-serif'];
  const SAMPLE = 'mmmmmmmmmmlli1WQ@#Ww0Oo';
  let context = null;
  let baseline = null;

  function measure(font) {
    context ||= document.createElement('canvas').getContext('2d');
    context.font = `72px ${font}`;
    return context.measureText(SAMPLE).width;
  }

  // A family is installed when text set in it differs from every generic fallback alone.
  function isInstalled(family) {
    if (!SpecterTheme.isValidFontFamily(family)) return false;
    baseline ||= GENERIC.map(measure);
    return GENERIC.some((generic, index) => measure(`"${family.trim()}", ${generic}`) !== baseline[index]);
  }

  function canListAll() {
    return typeof root.queryLocalFonts === 'function';
  }

  async function accessState() {
    if (!canListAll()) return 'unsupported';
    try {
      return (await navigator.permissions.query({ name: 'local-fonts' })).state;
    } catch (error) {
      return 'prompt';
    }
  }

  function probeCommon() {
    return COMMON_FAMILIES.filter(isInstalled).sort((a, b) => a.localeCompare(b));
  }

  // Must run from a click while access is still "prompt": the browser asks the user first.
  // Some Chromium builds resolve an empty list instead of rejecting when access is
  // refused, so an empty answer falls back to checking common families.
  async function listInstalled() {
    if (canListAll()) {
      let fonts = [];
      try {
        fonts = await root.queryLocalFonts();
      } catch (error) {
        return { complete: false, blocked: true, families: probeCommon() };
      }
      const families = [...new Set(fonts.map((font) => font.family).filter((family) => SpecterTheme.isValidFontFamily(family)))];
      if (families.length) return { complete: true, blocked: false, families: families.sort((a, b) => a.localeCompare(b)) };
      return { complete: false, blocked: true, families: probeCommon() };
    }
    return { complete: false, blocked: false, families: probeCommon() };
  }

  root.SpecterFonts = { isInstalled, canListAll, accessState, listInstalled };
}(globalThis));
