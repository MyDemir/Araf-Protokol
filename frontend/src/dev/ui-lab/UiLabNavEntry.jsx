import React from 'react';

export const UiLabNavEntry = ({ enabled, currentView, setCurrentView, mobile = false }) => {
  if (!enabled) return null;
  if (mobile) {
    return (
      <button onClick={() => setCurrentView('uiLab')} aria-label="UI Lab" className={`p-2 text-xl transition-all ${currentView === 'uiLab' ? 'text-fuchsia-300 drop-shadow-[0_0_8px_rgba(217,70,239,0.5)] -translate-y-1' : 'text-slate-600'}`}>
        🧪
      </button>
    );
  }
  return (
    <button onClick={() => setCurrentView('uiLab')} title="UI Lab" className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${currentView === 'uiLab' ? 'bg-fuchsia-900/30 text-fuchsia-300' : 'text-slate-500 hover:text-white hover:bg-[#111113]'}`}>
      🧪
    </button>
  );
};

export default UiLabNavEntry;
