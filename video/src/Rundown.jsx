import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const green = "#63ff8a", ink = "#050807", panel = "#101713", muted = "#9aaba0";
const categories = { top: "TOP PLAYERS", due: "DUE PLAYERS", sleepers: "SLEEPERS", closing: "MODEL MOVERS" };
const playersFor = (data, id) => id === "top" ? data.selectedPlayers.top : id === "due" ? data.selectedPlayers.due : id === "sleepers" ? data.selectedPlayers.sleepers : data.selectedPlayers.movers;

function Brand() { return <div style={{ position: "absolute", top: 48, left: 64, fontWeight: 900, letterSpacing: 3, color: green, fontSize: 30 }}>THE SLIP LAB</div>; }
function PlayerCard({ player, index }) {
  return <div style={{ background: panel, border: "2px solid #26382d", borderLeft: `8px solid ${green}`, borderRadius: 18, padding: "22px 26px", minHeight: 160 }}>
    <div style={{ color: muted, fontSize: 18, fontWeight: 800 }}>#{player.rank} · {player.team} vs {player.opponent}</div>
    <div style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{player.name}</div>
    <div style={{ color: green, fontSize: 24, marginTop: 8 }}>{player.realHrProbability}% HR · {player.pitcher}</div>
    <div style={{ display: "flex", gap: 12, marginTop: 15 }}>{[["POWER", player.powerScore], ["PITCH EDGE", player.pitchEdge], ["ZONE", player.zoneOverlap]].map(([k,v]) => <span key={k} style={{ background: "#1a2920", borderRadius: 9, padding: "7px 10px", fontSize: 16 }}>{k} {Math.round(v)}</span>)}</div>
  </div>;
}
function Scene({ segment, data }) {
  const frame = useCurrentFrame(); const fade = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const { width, height, fps } = useVideoConfig();
  const words = segment.text.split(/\s+/); const chunkSize = 16;
  const chunkIndex = Math.min(Math.floor((frame / fps) / 4), Math.max(0, Math.ceil(words.length / chunkSize) - 1));
  const caption = words.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize).join(" ");
  const players = playersFor(data, segment.id);
  const scale = Math.min(width / 1920, height / 1080);
  return <AbsoluteFill style={{ background: ink }}><div style={{ position: "absolute", width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "top left", background: `radial-gradient(circle at 85% 10%, #12371d 0%, ${ink} 44%)`, color: "white", fontFamily: "Arial, Helvetica, sans-serif", padding: "110px 64px 150px", opacity: fade, boxSizing: "border-box" }}>
    <Brand />
    {segment.id === "opening" ? <div style={{ margin: "auto 0", maxWidth: 1400 }}><div style={{ color: green, fontSize: 34, fontWeight: 900 }}>MLB DAILY RUNDOWN</div><h1 style={{ fontSize: 108, lineHeight: .95, margin: "20px 0" }}>{data.slateDate}</h1><div style={{ fontSize: 38, color: muted }}>{data.slate.gameCount} games · Top Players · Due Players · Sleepers</div></div> : <>
      <div style={{ color: green, fontSize: 26, fontWeight: 900, letterSpacing: 4 }}>{categories[segment.id]}</div>
      <h1 style={{ fontSize: 70, margin: "12px 0 30px" }}>{segment.title}</h1>
      <div style={{ display: "grid", gridTemplateColumns: players.length > 3 ? "1fr 1fr" : "1fr", gap: 18, maxWidth: 1500 }}>{players.slice(0, 5).map((p,i) => <PlayerCard key={p.playerId} player={p} index={i} />)}</div>
    </>}
    <div style={{ position: "absolute", bottom: 32, left: 170, right: 170, background: "rgba(0,0,0,.88)", border: "1px solid #294332", borderRadius: 14, padding: "16px 24px", color: "#f4fff6", fontSize: 26, textAlign: "center", lineHeight: 1.25 }}>{caption}</div>
  </div></AbsoluteFill>;
}
export function DailyMlbRundown(data) {
  let start = 0;
  return <AbsoluteFill style={{ background: ink }}>
    {data.audio?.status !== "skipped" && <Audio src={staticFile(`generated/${data.audio.file}`)} volume={1} />}
    {data.audio?.background?.file && <Audio src={staticFile(`generated/${data.audio.background.file}`)} volume={data.audio.background.volume} loop />}
    {data.narrationSegments.map(segment => { const from = start; const duration = Math.round(segment.durationSeconds * data.fps); start += duration; return <Sequence key={segment.id} from={from} durationInFrames={duration}><Scene segment={segment} data={data} /></Sequence>; })}
  </AbsoluteFill>;
}
