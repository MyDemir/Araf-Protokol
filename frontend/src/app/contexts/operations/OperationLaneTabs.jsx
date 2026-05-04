import React from 'react';

export const OperationLaneTabs = ({ lanes = [], activeLaneKey, setActiveLaneKey }) => {
  if (!lanes.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {lanes.map((lane) => (
        <button
          key={lane.key}
          onClick={() => setActiveLaneKey(lane.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${activeLaneKey === lane.key ? 'bg-[#222] text-white border-[#333]' : 'bg-[#101014] text-slate-400 border-[#222] hover:text-white'}`}
        >
          {lane.label} ({lane.items.length})
        </button>
      ))}
    </div>
  );
};

export default OperationLaneTabs;
