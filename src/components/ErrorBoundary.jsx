import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('Cappture error', err, info) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="center" style={{ textAlign: 'center' }}>
        <div className="panel panel-b col" style={{ maxWidth: 460, gap: 10 }}>
          <h2>Something went wrong on this page</h2>
          <p className="small muted" style={{ margin: 0 }}>Your time is safe, this is just a display error. Reload the page and if it keeps happening send Ben the message below.</p>
          <code className="tiny" style={{ background: 'var(--bg)', padding: 8, borderRadius: 8, textAlign: 'left', whiteSpace: 'pre-wrap' }}>{String(this.state.err?.message || this.state.err)}</code>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
