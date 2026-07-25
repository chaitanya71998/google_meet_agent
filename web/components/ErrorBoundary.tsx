'use client';

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof window !== 'undefined') {
      try {
        const Sentry = (window as any).Sentry;
        if (Sentry?.captureException) Sentry.captureException(error, { extra: info });
      } catch {}
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="center" style={{ flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ color: 'var(--text)', margin: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--muted)', maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button className="primary-btn" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
