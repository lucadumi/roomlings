import iphoneScreen from '../assets/app/iphone-room.webp'
import ipadScreen from '../assets/app/ipad-room.webp'

// Shown to iPhone and iPad visitors, who use the native app instead of the browser household.
// The hero's action note describes availability, so the store button reuses it.
export function IosAppPreview({ storeUrl }: { storeUrl: string | null }) {
  return <section className="welcome-app welcome-container" id="ios-app" aria-labelledby="ios-app-title">
    <div className="welcome-app-copy">
      <h2 id="ios-app-title">Roomlings for iPhone and iPad.</h2>
      <div className="welcome-actions">
        {storeUrl
          ? <a className="welcome-store" href={storeUrl} target="_blank" rel="noopener" aria-label="Download on the App Store" aria-describedby="welcome-action-note">
            <StoreBadge line="Download on the" />
          </a>
          : <button className="welcome-store" type="button" disabled aria-label="Coming soon to the App Store" aria-describedby="welcome-action-note">
            <StoreBadge line="Coming soon to the" />
          </button>}
      </div>
    </div>
    <figure className="welcome-app-preview">
      <div className="welcome-device">
        <div className="welcome-device-body">
          <picture>
            <source media="(min-width: 760px)" srcSet={ipadScreen} />
            <img className="welcome-app-screen" src={iphoneScreen} alt="The Roomlings app showing a shared kitchen with its household tools"
              decoding="async" draggable={false} />
          </picture>
          <span className="welcome-device-sensor" aria-hidden="true" />
        </div>
      </div>
    </figure>
  </section>
}

// Apple platforms draw their logo for U+F8FF in the system font, and this section is only shown there.
function StoreBadge({ line }: { line: string }) {
  return <>
    <span className="welcome-store-logo" aria-hidden="true">{'\uf8ff'}</span>
    <span className="welcome-store-text" aria-hidden="true"><small>{line}</small><strong>App Store</strong></span>
  </>
}
