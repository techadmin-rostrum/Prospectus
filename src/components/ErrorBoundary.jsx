import { Component } from 'react';

/**
 * React swallows render errors and unmounts the whole tree when nothing catches
 * them, which is indistinguishable from a blank page. This hands the error —
 * with the component stack, which a global handler can't see — to the overlay
 * installed in index.html so it stays visible on devices we can't inspect.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    const stack = [error?.stack, info?.componentStack && `Component stack:${info.componentStack}`]
      .filter(Boolean)
      .join('\n\n');

    window.__flipbookReportFatal?.(
      this.props.label ? `Crash in ${this.props.label}` : 'The page crashed while rendering',
      error?.message || String(error),
      stack
    );
  }

  render() {
    // The overlay owns the failure UI; rendering nothing avoids a second,
    // competing error screen.
    return this.state.failed ? null : this.props.children;
  }
}
