// Outdoor NFL venues used by the current regular-season schedule.
// Keep this schedule-wide: weather coverage must not regress when the active week changes.
export const NFL_OUTDOOR_VENUES = Object.freeze({
  "Acrisure Stadium": [40.4468, -80.0158],
  "Arrowhead Stadium": [39.0489, -94.4839],
  "Bank of America Stadium": [35.2258, -80.8528],
  "Empower Field at Mile High": [39.7439, -105.0201],
  "Estadio Banorte": [25.6692, -100.2443],
  "EverBank Stadium": [30.3239, -81.6373],
  "FC Bayern Munich Stadium": [48.2188, 11.6247],
  "Gillette Stadium": [42.0909, -71.2643],
  "Hard Rock Stadium": [25.9580, -80.2389],
  "Highmark Stadium": [42.7738, -78.7868],
  "Huntington Bank Field": [41.5061, -81.6995],
  "Lambeau Field": [44.5013, -88.0622],
  "Levi's Stadium": [37.4030, -121.9700],
  "Lincoln Financial Field": [39.9008, -75.1675],
  "Lumen Field": [47.5952, -122.3316],
  "M&T Bank Stadium": [39.2780, -76.6227],
  "Maracanã Stadium": [-22.9122, -43.2302],
  "Melbourne Cricket Ground": [-37.8199, 144.9834],
  "MetLife Stadium": [40.8135, -74.0745],
  "Nissan Stadium": [36.1665, -86.7713],
  "Northwest Stadium": [38.9077, -76.8645],
  "Paycor Stadium": [39.0955, -84.5161],
  "Raymond James Stadium": [27.9759, -82.5033],
  "SoFi Stadium": [33.9535, -118.3392],
  "Soldier Field": [41.8623, -87.6167],
  "Stade de France": [48.9245, 2.3601],
  "Tottenham Hotspur Stadium": [51.6043, -0.0664],
  "Wembley Stadium": [51.5560, -0.2796]
});

export function missingOutdoorVenues(games = []) {
  return [...new Set(games.filter(game => !game.indoor && !NFL_OUTDOOR_VENUES[game.venue]).map(game => game.venue))].sort();
}
