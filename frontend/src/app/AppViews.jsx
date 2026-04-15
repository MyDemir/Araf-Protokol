import React from 'react';

// [TR] Behavior-preserving modularization: mevcut render helper adları korunur.
// [EN] Behavior-preserving modularization: keep existing render helper names intact.
export const renderSlimRail = (controller) => controller.renderSlimRail();
export const renderContextSidebar = (controller) => controller.renderContextSidebar();
export const renderHome = (controller) => controller.renderHome();
export const renderMarket = (controller) => controller.renderMarket();
export const renderTradeRoom = (controller) => controller.renderTradeRoom();
export const renderMobileNav = (controller) => controller.renderMobileNav();
export const renderFooter = (controller) => controller.renderFooter();

export default function AppViews({ controller }) {
  return (
    <>
      {renderSlimRail(controller)}
      {renderContextSidebar(controller)}
      {renderMobileNav(controller)}

      <div className="flex-1 overflow-y-auto relative bg-[#060608]">
        <div className="min-h-full flex flex-col pt-4 md:pt-10 pb-24 md:pb-10 items-center">
          {controller.currentView === 'home'
            ? renderHome(controller)
            : controller.currentView === 'market'
              ? renderMarket(controller)
              : renderTradeRoom(controller)}
          {renderFooter(controller)}
        </div>
      </div>
    </>
  );
}
