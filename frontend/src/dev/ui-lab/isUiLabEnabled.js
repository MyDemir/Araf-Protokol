export const isUiLabEnabled = (env = import.meta.env) => {
  const flag = String(env?.VITE_ENABLE_UI_LAB || '').toLowerCase() === 'true';
  if (flag) return true;
  if (env?.PROD) return false;
  return Boolean(env?.DEV);
};

export default isUiLabEnabled;
