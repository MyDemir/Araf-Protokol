import React from 'react';
import { SystemStatusBar } from './SystemStatusBar';
import { ContextNavigation } from './ContextNavigation';
import { ContextOutlet } from './ContextOutlet';
import { ContextPanel } from './ContextPanel';
import { ModalHost } from './ModalHost';
import { MobileTopBar } from './MobileTopBar';
import { MobileBottomNav } from './MobileBottomNav';

export const AppShell = ({
  children,
  status = null,
  systemStatusProps = {},
  navigation = null,
  panel = null,
  outlet = null,
  modals = null,
  mobileTop = null,
  mobileBottom = null,
}) => {
  return (
    <div className="flex flex-col md:flex-row h-full pb-16 md:pb-0">
      <SystemStatusBar {...systemStatusProps}>{status}</SystemStatusBar>
      <MobileTopBar>{mobileTop}</MobileTopBar>
      <ContextNavigation>{navigation}</ContextNavigation>
      <ContextPanel>{panel}</ContextPanel>
      <ContextOutlet>{outlet || children}</ContextOutlet>
      <MobileBottomNav>{mobileBottom}</MobileBottomNav>
      <ModalHost>{modals}</ModalHost>
    </div>
  );
};

export default AppShell;
