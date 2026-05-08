export const isUiLabEnabled = (env = import.meta.env) => {
  if (env?.PROD) return false;
  const flag = String(env?.VITE_ENABLE_UI_LAB || '').toLowerCase() === 'true';
  return Boolean(env?.DEV || flag);
};

export default isUiLabEnabled;
