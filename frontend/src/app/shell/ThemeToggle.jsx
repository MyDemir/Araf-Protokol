import React from 'react';
import { useThemeMode } from '../providers/ThemeProvider';

export const ThemeToggle = () => {
  const { themeMode, setThemeMode } = useThemeMode();
  return (
    <select value={themeMode} onChange={(e) => setThemeMode(e.target.value)} className="bg-transparent text-xs border border-[#333] rounded px-2 py-1">
      <option value="system">System</option>
      <option value="day">Day</option>
      <option value="night">Night</option>
    </select>
  );
};

export default ThemeToggle;
