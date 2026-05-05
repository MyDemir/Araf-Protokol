import React from 'react';

export const ContextNavigation = ({ children = null }) => {
  if (!children) return null;
  return (
    <div className="hidden md:flex w-16 bg-black border-r border-[#1a1a1a] flex-col items-center py-6 justify-between z-50 shrink-0 shadow-2xl">
      {children}
    </div>
  );
};

export default ContextNavigation;
