import React from 'react';

export const MobileBottomNav = ({ children = null }) => {
  if (!children) return null;
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#060608] border-t border-[#1a1a1a] z-[45] flex items-center justify-around px-2 pb-safe shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
      {children}
    </div>
  );
};

export default MobileBottomNav;
