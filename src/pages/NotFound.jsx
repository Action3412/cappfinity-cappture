import { Link } from 'react-router-dom'
import { Illo } from '../components/Empty.jsx'

export default function NotFound() {
  return (
    <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
      <div className="empty" style={{ maxWidth: 420 }}>
        <Illo kind="lost" size={88} />
        <div className="col" style={{ gap: 6, alignItems: 'center' }}>
          <h1 style={{ fontSize: 24 }}>That page isn't here.</h1>
          <p className="muted" style={{ margin: 0, textAlign: 'center' }}>Either the link is old or it was never a page. Your week is still where you left it.</p>
        </div>
        <Link className="btn primary" to="/">Back to my week</Link>
      </div>
    </div>
  )
}
