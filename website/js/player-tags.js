(function(){
  function n(v){
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }

  function norm(s){
    return String(s || "").trim();
  }

  function uniqueTags(tags){
    const seen = new Set();
    return tags
      .map(norm)
      .filter(Boolean)
      .filter(t => {
        const k = t.toLowerCase();
        if(seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }

  function buildSlipLabTags(row, model, rank){
    const r = row || {};
    const m = model || r || {};
    const tags = [];

    if(Array.isArray(r.tags)) tags.push(...r.tags);
    if(Array.isArray(r.badges)) tags.push(...r.badges);
    if(Array.isArray(m.tags)) tags.push(...m.tags);
    if(Array.isArray(m.badges)) tags.push(...m.badges);

    const resolvedRank =
      n(rank) ||
      n(r.modelRank) ||
      n(r.rank) ||
      n(m.modelRank) ||
      n(m.rank);

    if(n(m.hrConfidence) >= 52 || n(r.hrConfidence) >= 52) tags.push("STRONG");
    else if(n(m.hrConfidence) >= 42 || n(r.hrConfidence) >= 42) tags.push("MODERATE");

    if(n(m.pitcherRisk) >= 55 || n(r.pitcherRisk) >= 55) tags.push("DANGER");
    if(n(m.pitchEdge) >= 55 || n(r.pitchEdge) >= 55) tags.push("PITCH EDGE");
    if(n(m.hotZoneCount) >= 5 || n(r.hotZoneCount) >= 5) tags.push("ZONE 5+");
    if(n(m.hitterZonePower) >= 60 || n(r.hitterZonePower) >= 60) tags.push("POWER ZONE");

    if(resolvedRank > 0 && resolvedRank <= 30) tags.push("TOP 30");
    if(resolvedRank > 0 && resolvedRank <= 10) tags.push("TOP 10");

    const sectionText = [
      r.aiDailySection,
      m.aiDailySection,
      r.aiSection,
      m.aiSection,
      r.section,
      m.section,
      ...(Array.isArray(r.sections) ? r.sections : []),
      ...(Array.isArray(m.sections) ? m.sections : []),
      ...(Array.isArray(r.aiSections) ? r.aiSections : []),
      ...(Array.isArray(m.aiSections) ? m.aiSections : []),
      ...(Array.isArray(r.aiDailySections) ? r.aiDailySections : []),
      ...(Array.isArray(m.aiDailySections) ? m.aiDailySections : [])
    ].join(" ");

    if(sectionText.includes("bestPicks")) tags.push("BEST PICK");
    if(sectionText.includes("safestPlays")) tags.push("SAFEST PLAY");
    if(sectionText.includes("bestValue")) tags.push("BEST VALUE");
    if(sectionText.includes("weatherCarry")) tags.push("WEATHER CARRY");
    if(sectionText.includes("bullpenBoosts")) tags.push("BULLPEN BOOST");
    if(sectionText.includes("ifOnlyOne")) tags.push("IF ONLY ONE");
    if(sectionText.includes("pitchTypeEdges")) tags.push("PITCH TYPE EDGE");
    if(sectionText.includes("lottoBombs")) tags.push("LOTTO BOMB");

    if(tags.length === 0) tags.push("HR");

    return uniqueTags(tags).slice(0, 10);
  }

  window.SlipLabTags = {
    build: buildSlipLabTags,
    unique: uniqueTags
  };
})();
