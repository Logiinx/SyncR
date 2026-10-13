import UpdateBanner from './UpdateBanner'

function App() {
  return (
    <>
      <UpdateBanner />
      <main>
        <h1>SyncR</h1>
        <p>Hello! The app is running.</p>
        <p className="version">v{__APP_VERSION__}</p>
      </main>
    </>
  )
}

export default App
