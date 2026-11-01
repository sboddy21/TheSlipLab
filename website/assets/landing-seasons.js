import { isSportInSeason } from '../lib/sport-seasons.mjs';

function updateSeasons() {
  document.querySelectorAll('[data-sport][data-season-href]').forEach(link => {
    const active = isSportInSeason(link.dataset.sport);
    link.classList.toggle('live', active);
    link.classList.toggle('offseason', !active);
    link.querySelector('span').textContent = active ? 'In season' : 'Offseason';
    if (active) {
      link.href = link.dataset.seasonHref;
      link.removeAttribute('aria-disabled');
      link.removeAttribute('title');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.title = `${link.querySelector('strong').textContent} is in the offseason`;
    }
  });
}
updateSeasons();
// Update tabs left open across a season boundary, including after device sleep.
setInterval(updateSeasons, 60_000);
document.addEventListener('visibilitychange', updateSeasons);
