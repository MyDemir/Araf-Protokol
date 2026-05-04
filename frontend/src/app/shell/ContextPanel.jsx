import React from 'react';

export const ContextPanel = ({ children = null, sidebarOpen = false, setSidebarOpen = () => {} }) => {
  return (
    <>
      {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/60 z-[55] backdrop-blur-sm transition-opacity" onClick={() => setSidebarOpen(false)} />}
      {children}
    </>
  );
};

export default ContextPanel;
