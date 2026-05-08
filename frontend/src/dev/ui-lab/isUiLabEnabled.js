export const isUiLabEnabled = (env = import.meta.env) => {
  const flag = String(env?.VITE_ENABLE_UI_LAB || '').toLowerCase() === 'true';
  return Boolean(env?.DEV || flag);
};

export default isUiLabEnabled;
