import React from 'react';
import { useThemeMode } from '../providers/ThemeProvider';

export const ThemeToggle = () => {
  const { themeMode, setThemeMode } = useThemeMode();
  return (
    <select aria-label="Theme mode" value={themeMode} onChange={(e) => setThemeMode(e.target.value)} className="w-full bg-surface text-textSecondary text-xs border border-borderStrong rounded px-1.5 py-1 hover:text-textPrimary focus:outline-none focus:ring-1 focus:ring-brand">
      <option value="system">System</option>
      <option value="day">Day</option>
      <option value="night">Night</option>
    </select>
  );
};

export default ThemeToggle;
