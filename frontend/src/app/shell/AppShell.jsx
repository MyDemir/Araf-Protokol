import React from 'react';
import { SystemStatusBar } from './SystemStatusBar';

export const AppShell = ({
  children,
  status = null,
  navigation = null,
  panel = null,
  outlet = null,
  modals = null,
  mobileTop = null,
  mobileBottom = null,
}) => {
  return (
    <>
      {status ? <SystemStatusBar {...status} /> : null}
      {mobileTop}
      <div className="flex flex-col md:flex-row min-h-0 flex-1">
        {navigation}
        {panel}
        {outlet || children}
      </div>
      {mobileBottom}
      {modals}
    </>
  );
};

export default AppShell;
