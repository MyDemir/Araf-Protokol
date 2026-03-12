/**
 * ErrorBoundary — Global Render Hata Sınırı
 *
 * L-05 Fix: React render hatalarını yakalar, uygulamanın tamamen çökmesini önler.
 * main.jsx'te <App /> sarmalanarak tüm uygulama kapsama alınır.
 *
 * React sınıf bileşeni olmak zorunda — hook'larla Error Boundary yazılamaz.
 */

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Render hatası:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-red-500/30 rounded-2xl p-8 max-w-md w-full text-center">
            <p className="text-4xl mb-4">⚠️</p>
            <h2 className="text-white font-bold text-xl mb-2">Beklenmedik Bir Hata Oluştu</h2>
            <p className="text-slate-400 text-sm mb-6">
              Uygulama yüklenirken bir sorun yaşandı. Sayfayı yenileyerek tekrar dene.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-6 rounded-xl transition"
            >
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
