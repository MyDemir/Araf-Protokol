import React from 'react';
import { useThemeMode } from '../providers/ThemeProvider';

export const ThemeToggle = () => {
  const { themeMode, setThemeMode } = useThemeMode();
  return (
    <select value={themeMode} onChange={(e) => setThemeMode(e.target.value)} className="bg-surface text-textSecondary text-xs border border-borderStrong rounded px-2 py-1 hover:text-textPrimary">
      <option value="system">System</option>
      <option value="day">Day</option>
      <option value="night">Night</option>
    </select>
  );
};

export default ThemeToggle;
