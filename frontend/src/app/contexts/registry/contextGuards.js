import { contextRegistryByKey } from './contextRegistry';

export const hasContextAccess = ({ contextKey, isAuthenticated }) => {
  const entry = contextRegistryByKey[contextKey];
  if (!entry) return false;
  if (!entry.requiresAuth) return true;
  return Boolean(isAuthenticated);
};

export default hasContextAccess;
